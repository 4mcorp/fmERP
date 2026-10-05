// M7 통합 테스트: 계정 전체 내보내기 API (권한·허용 설정·재인증·요청·내려받기·격리) (실제 DB·S3)
import { createDatabase, schema } from "@fmerp/db";
import { ObjectStorage } from "@fmerp/storage";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientWithCookie, json, loginAs, type TestClient } from "./test-client";

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name}이 없습니다`);
  return v;
};
const owner = createDatabase(need("MIGRATION_DATABASE_URL"));
const authDb = createDatabase(need("AUTH_DATABASE_URL"));
const storage = new ObjectStorage({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "us-east-1",
  bucket: need("S3_BUCKET"),
  accessKeyId: need("S3_ACCESS_KEY_ID"),
  secretAccessKey: need("S3_SECRET_ACCESS_KEY"),
  forcePathStyle: true,
});

const clients: Record<string, TestClient> = {};
let accountA = "";
let accountB = "";
const ids: Record<string, string> = {};

const req = (who: string, path: string, method = "GET", body?: unknown) =>
  (clients[who] as TestClient).request(path, {
    method,
    body: body === undefined && method !== "GET" ? {} : body,
    headers: { "x-forwarded-for": "198.51.100.20" },
  });

/** 이 파일이 설정한 PIN을 지운다. M1의 PIN 시험은 owner에게 PIN이 아직 없다고 가정한다 (파일 실행 순서에 영향을 주지 않게) */
async function resetPins(emails: string[]) {
  await owner.pool.query(
    'delete from approval_pin where user_id in (select id from "user" where email = any($1::text[]))',
    [emails],
  );
}

async function verifyPin(who: string) {
  await req(who, "/api/me/pin", "PUT", { pin: "246810" });
  for (const pin of ["246810", "135790", "482915"]) {
    if ((await req(who, "/api/me/pin/verify", "POST", { pin })).status === 200) return;
  }
  throw new Error("PIN을 확인하지 못했습니다");
}

const clearJobs = () =>
  owner.pool.query("delete from backup_job where account_id = any($1::uuid[])", [
    [accountA, accountB],
  ]);

async function setAdminExport(value: boolean) {
  await owner.pool.query(
    "update account set security_policy = jsonb_set(security_policy, '{allowAdminExport}', $2::jsonb) where id = $1",
    [accountA, JSON.stringify(value)],
  );
}

/** 완성된 내보내기 한 건 (실제 객체 포함) */
async function seedReady(
  accountId: string,
  requestedBy: string,
  over: { expiresInDays?: number; body?: string } = {},
) {
  const jobId = crypto.randomUUID();
  const key = `exports/${accountId}/${jobId}.zip`;
  await storage.put(key, over.body ?? "PK 내보내기 흉내", "application/zip");
  const info = await storage.hashObject(key);
  await owner.pool.query(
    `insert into backup_job (id, account_id, status, requested_by_membership_id, finished_at, size, sha256, storage_key, expires_at)
     values ($1, $2, 'READY', $3, now(), $4, $5, $6, now() + ($7 || ' days')::interval)`,
    [jobId, accountId, requestedBy, info.size, info.sha256, key, String(over.expiresInDays ?? 7)],
  );
  return { jobId, key };
}

beforeAll(async () => {
  for (const who of ["owner", "admin", "member1", "auditor", "owner-b"]) {
    clients[who] = await loginAs(`${who}@example.com`);
  }
  const acc = await owner.pool.query("select id, slug from account");
  accountA = acc.rows.find((a) => a.slug === "fourm-test")?.id;
  // owner-b가 다른 테스트 때문에 회사를 여러 개 가질 수 있어, 슬러그가 아니라 그 세션의 활성 회사를 쓴다
  accountB = (await json<{ activeAccountId: string }>(await req("owner-b", "/api/me")))
    .activeAccountId;
  const m = await owner.pool.query(
    'select m.id, u.email, m.account_id from membership m join "user" u on u.id = m.user_id',
  );
  for (const r of m.rows) ids[`${r.email}:${r.account_id}`] = r.id;
  await clearJobs();
  await setAdminExport(false);
});

afterAll(async () => {
  await clearJobs();
  await resetPins(["owner@example.com", "owner-b@example.com", "admin@example.com"]);
  await setAdminExport(false);
  await owner.pool.end();
  await authDb.pool.end();
});

describe("내보내기 권한 (PRD 3.3 각주 2)", () => {
  it("소유자만 쓰고, 계정 관리자는 허용되기 전에는 못 쓴다 (403)", async () => {
    expect((await req("owner", "/api/account/exports")).status).toBe(200);
    for (const who of ["admin", "member1", "auditor"]) {
      expect((await req(who, "/api/account/exports")).status, `${who} 목록`).toBe(403);
      expect((await req(who, "/api/account/exports", "POST")).status, `${who} 요청`).toBe(403);
    }
  });

  it("허용 설정은 소유자만 바꿀 수 있고, 허용하면 계정 관리자도 쓸 수 있다", async () => {
    const patch = (who: string, value: boolean) =>
      req(who, "/api/account/settings", "PATCH", { securityPolicy: { allowAdminExport: value } });
    // 관리자가 스스로 허용하지는 못한다
    expect((await patch("admin", true)).status).toBe(403);
    expect((await req("admin", "/api/account/exports")).status).toBe(403);
    // 소유자가 허용
    expect((await patch("owner", true)).status).toBe(200);
    expect((await req("admin", "/api/account/exports")).status).toBe(200);
    const caps = await json<Record<string, boolean>>(
      await req("admin", "/api/account/capabilities"),
    );
    expect(caps["account.export"]).toBe(true);
    // 다시 끄면 막힌다
    expect((await patch("owner", false)).status).toBe(200);
    expect((await req("admin", "/api/account/exports")).status).toBe(403);
    expect(
      (await json<Record<string, boolean>>(await req("admin", "/api/account/capabilities")))[
        "account.export"
      ],
    ).toBe(false);
    expect(
      (await json<Record<string, boolean>>(await req("owner", "/api/account/capabilities")))[
        "account.export"
      ],
    ).toBe(true);
  });

  it("로그인하지 않으면 401", async () => {
    const anon = clientWithCookie("");
    expect((await anon.request("/api/account/exports")).status).toBe(401);
    expect((await anon.request("/api/account/exports", { method: "POST", body: {} })).status).toBe(
      401,
    );
  });
});

describe("내보내기 요청", () => {
  it("PIN 재인증이 없으면 428, 재인증하면 요청이 대기열에 들어가 감사 로그가 남고, 동시에 하나만 요청할 수 있다", async () => {
    await clearJobs();
    clients.ownerFresh = await loginAs("owner@example.com");
    expect((await req("ownerFresh", "/api/account/exports", "POST")).status).toBe(428);
    await verifyPin("ownerFresh");
    const res = await req("ownerFresh", "/api/account/exports", "POST");
    expect(res.status).toBe(201);
    const { id } = await json<{ id: string }>(res);

    const { rows } = await owner.pool.query("select * from backup_job where id = $1", [id]);
    expect(rows[0]).toMatchObject({
      status: "QUEUED",
      account_id: accountA,
      type: "account_export",
    });
    expect(rows[0].requested_by_membership_id).toBe(ids[`owner@example.com:${accountA}`]);

    const audit = await authDb.db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.action, "account.export_request"), eq(schema.auditLog.targetId, id)),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.accountId).toBe(accountA);
    expect(audit[0]?.ip).toBe("198.51.100.20");

    const again = await req("ownerFresh", "/api/account/exports", "POST");
    expect(again.status).toBe(409);
    expect(await json(again)).toMatchObject({ code: "export_active" });
    // 다른 회사는 따로 요청할 수 있다
    await verifyPin("owner-b");
    expect((await req("owner-b", "/api/account/exports", "POST")).status).toBe(201);
    await clearJobs();
  });

  it("이력은 최근 순이고 요청자 이름과 상태를 보여 주며 다른 계정의 이력은 보이지 않는다", async () => {
    await clearJobs();
    const a = await seedReady(accountA, ids[`owner@example.com:${accountA}`] as string);
    const b = await seedReady(accountB, ids[`owner-b@example.com:${accountB}`] as string);
    const list = await json<{
      items: { id: string; status: string; requestedByName: string | null }[];
    }>(await req("owner", "/api/account/exports"));
    expect(list.items.map((i) => i.id)).toEqual([a.jobId]);
    expect(list.items[0]).toMatchObject({ status: "READY", requestedByName: "김대표" });
    const other = await json<{ items: { id: string }[] }>(
      await req("owner-b", "/api/account/exports"),
    );
    expect(
      other.items.map((i) => i.id),
      JSON.stringify(other),
    ).toEqual([b.jobId]);
    await clearJobs();
  });
});

describe("내보내기 내려받기 (BAK-009)", () => {
  it("재인증하면 짧은 서명 URL을 받아 실제로 내려받고, 받을 때마다 이력이 남는다", async () => {
    await clearJobs();
    const { jobId } = await seedReady(accountA, ids[`owner@example.com:${accountA}`] as string, {
      body: "ZIP 본문",
    });
    await verifyPin("owner");
    const res = await req("owner", `/api/account/exports/${jobId}/download`);
    expect(res.status).toBe(200);
    const { url, filename, expiresInSeconds } = await json<{
      url: string;
      filename: string;
      expiresInSeconds: number;
    }>(res);
    expect(expiresInSeconds).toBe(600);
    expect(filename).toMatch(/^fmerp-export-\d{8}-[0-9a-f]{8}\.zip$/);
    const file = await fetch(url);
    expect(file.status).toBe(200);
    expect(await file.text()).toBe("ZIP 본문");

    await req("owner", `/api/account/exports/${jobId}/download`);
    const list = await json<{ items: { id: string; downloads: { userName: string | null }[] }[] }>(
      await req("owner", "/api/account/exports"),
    );
    expect(list.items.find((i) => i.id === jobId)?.downloads).toHaveLength(2);
    const audit = await authDb.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, "account.export_download"),
          eq(schema.auditLog.targetId, jobId),
        ),
      );
    expect(audit).toHaveLength(2);
    expect(audit.every((r) => r.accountId === accountA && r.ip === "198.51.100.20")).toBe(true);
    await clearJobs();
  });

  it("재인증이 없으면 428이고, 아직 만드는 중·만료된 것·남의 회사 것은 받을 수 없다", async () => {
    await clearJobs();
    clients.ownerFresh2 = await loginAs("owner@example.com");
    const me = ids[`owner@example.com:${accountA}`] as string;
    const ready = await seedReady(accountA, me);
    expect((await req("ownerFresh2", `/api/account/exports/${ready.jobId}/download`)).status).toBe(
      428,
    );

    await verifyPin("owner");
    const queued = (
      await owner.pool.query(
        "insert into backup_job (account_id, requested_by_membership_id) values ($1, $2) returning id",
        [accountA, me],
      )
    ).rows[0].id;
    expect((await req("owner", `/api/account/exports/${queued}/download`)).status).toBe(409);
    await owner.pool.query(
      "update backup_job set status = 'FAILED', finished_at = now() where id = $1",
      [queued],
    );

    const old = await seedReady(accountA, me, { expiresInDays: -1 });
    const expired = await req("owner", `/api/account/exports/${old.jobId}/download`);
    expect(expired.status).toBe(409);
    expect(await json(expired)).toMatchObject({ code: "export_expired" });

    // 다른 회사 소유자는 이 작업이 있는지도 모른다 (RLS → 404)
    await verifyPin("owner-b");
    expect((await req("owner-b", `/api/account/exports/${ready.jobId}/download`)).status).toBe(404);
    // 구성원은 권한이 없다
    expect((await req("member1", `/api/account/exports/${ready.jobId}/download`)).status).toBe(403);
    await clearJobs();
  });

  it("DB의 저장소 키가 이 계정의 내보내기 경로 밖을 가리키면 URL을 만들지 않는다 (다층 방어)", async () => {
    await clearJobs();
    await verifyPin("owner");
    const me = ids[`owner@example.com:${accountA}`] as string;
    // 다른 계정의 내보내기 파일을 가리키는 READY 행 (앱 역할은 이런 행을 만들 수 없지만, 만들어졌다고 가정한다)
    const foreign = await seedReady(accountB, ids[`owner-b@example.com:${accountB}`] as string, {
      body: "다른 회사 ZIP",
    });
    const jobId = crypto.randomUUID();
    await owner.pool.query(
      `insert into backup_job (id, account_id, status, requested_by_membership_id, finished_at, size, sha256, storage_key, expires_at)
       values ($1, $2, 'READY', $3, now(), 1, 'a', $4, now() + interval '7 days')`,
      [jobId, accountA, me, foreign.key],
    );
    const res = await req("owner", `/api/account/exports/${jobId}/download`);
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ code: "export_invalid" });
    await clearJobs();
  });
});

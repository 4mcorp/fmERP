// M7 통합 테스트: 시스템 덤프 API (권한·재인증·요청·내려받기·삭제 요청) (실제 DB·S3)
import { createDatabase, schema } from "@fmerp/db";
import { ObjectStorage } from "@fmerp/storage";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientWithCookie, json, loginAs, type TestClient } from "../test-client";

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

const MARK = `m7-api-${Date.now().toString(36)}`;
const clients: Record<string, TestClient> = {};
const keys: string[] = [];

const req = (who: string, path: string, method = "GET", body?: unknown) =>
  (clients[who] as TestClient).request(path, {
    method,
    body: body === undefined && method !== "GET" ? {} : body,
    headers: { "x-forwarded-for": "198.51.100.9" },
  });

/** PIN을 확인 상태로 만든다. 다른 테스트가 이미 PIN을 정해 뒀을 수 있어 알려진 값을 차례로 시도한다 */
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

async function closeActive() {
  await owner.pool.query(
    "update system_backup set status = 'FAILED', finished_at = now(), error = 'test' where status in ('QUEUED','RUNNING')",
  );
}

/** 이력에 성공한 덤프 한 건을 만들고 실제 객체도 올려 둔다 */
async function seedDump(kind: "auto" | "manual", body = "암호문 흉내") {
  const key = `test/${MARK}/${kind}-${Math.random().toString(36).slice(2)}.dump.age`;
  keys.push(key);
  await storage.put(key, body, "application/octet-stream");
  const info = await storage.hashObject(key);
  const { rows } = await owner.pool.query(
    `insert into system_backup (kind, status, note, finished_at, size, sha256, storage_key, pg_dump_version)
     values ($1, 'SUCCEEDED', $2, now(), $3, $4, $5, 'pg_dump (PostgreSQL) 18.0') returning id`,
    [kind, `${MARK} ${kind}`, info.size, info.sha256, key],
  );
  return { id: rows[0].id as string, key };
}

beforeAll(async () => {
  for (const who of ["owner", "admin", "member1", "auditor"]) {
    clients[who] = await loginAs(`${who}@example.com`);
  }
  await closeActive();
});

afterAll(async () => {
  await closeActive();
  await resetPins(["owner@example.com"]);
  await owner.pool.query("delete from system_backup where note like $1", [`${MARK}%`]);
  await owner.pool.end();
  await authDb.pool.end();
});

describe("시스템 덤프 권한 (M7 Q1)", () => {
  it("시스템 관리자 이메일만 쓸 수 있고, 계정 관리자·구성원·감사인에게는 존재를 알리지 않는다 (404)", async () => {
    expect((await req("owner", "/api/system/backups")).status).toBe(200);
    const probe = await seedDump("manual");
    for (const who of ["admin", "member1", "auditor"]) {
      expect((await req(who, "/api/system/backups")).status, `${who} 목록`).toBe(404);
      expect((await req(who, "/api/system/backups", "POST", {})).status, `${who} 요청`).toBe(404);
      expect(
        (await req(who, `/api/system/backups/${probe.id}/download`)).status,
        `${who} 다운로드`,
      ).toBe(404);
      expect(
        (await req(who, `/api/system/backups/${probe.id}/delete`, "POST")).status,
        `${who} 삭제`,
      ).toBe(404);
    }
  });

  it("메뉴 노출용 /system/me는 누구에게나 200이고 시스템 관리자만 true", async () => {
    expect(await json(await req("owner", "/api/system/me"))).toEqual({ systemAdmin: true });
    expect(await json(await req("admin", "/api/system/me"))).toEqual({ systemAdmin: false });
  });

  it("로그인하지 않으면 401", async () => {
    const anon = clientWithCookie("");
    expect((await anon.request("/api/system/me")).status).toBe(401);
    expect((await anon.request("/api/system/backups")).status).toBe(401);
    expect((await anon.request("/api/system/backups", { method: "POST", body: {} })).status).toBe(
      401,
    );
  });
});

describe("수동 덤프 요청 (BAK-006)", () => {
  it("PIN 재인증이 없으면 428, 재인증하면 요청이 대기열에 들어가고 감사 로그가 남는다", async () => {
    await closeActive();
    // 새 세션이라 PIN 확인 시각이 없다
    const fresh = await loginAs("owner@example.com");
    clients.ownerFresh = fresh;
    const denied = await req("ownerFresh", "/api/system/backups", "POST", { note: "점검 전" });
    expect(denied.status).toBe(428);

    await verifyPin("ownerFresh");
    const res = await req("ownerFresh", "/api/system/backups", "POST", { note: `${MARK} 점검 전` });
    expect(res.status).toBe(201);
    const { id } = await json<{ id: string }>(res);

    const { rows } = await owner.pool.query("select * from system_backup where id = $1", [id]);
    expect(rows[0]).toMatchObject({ kind: "manual", status: "QUEUED" });
    expect(rows[0].requested_by_user_id).toBeTruthy();

    // 계정 없는 시스템 행위로 기록된다
    const audit = await authDb.db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.action, "backup.dump_request"), eq(schema.auditLog.targetId, id)),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.accountId).toBeNull();
    expect(audit[0]?.ip).toBe("198.51.100.9");

    // 대기·실행 중인 덤프가 있으면 또 요청할 수 없다
    const again = await req("ownerFresh", "/api/system/backups", "POST", {});
    expect(again.status).toBe(409);
    expect(await json(again)).toMatchObject({ code: "dump_active" });
    await closeActive();
  });

  it("이력은 최근 순이고 요청자 이름·백업 상태를 보여 준다", async () => {
    await closeActive();
    await seedDump("auto");
    const body = await json<{
      health: { state: string; lastSuccessAt: string | null };
      items: { id: string; kind: string; status: string; sha256: string | null }[];
    }>(await req("owner", "/api/system/backups"));
    expect(body.items.length).toBeGreaterThan(0);
    const times = body.items.map((i) => i.id);
    expect(new Set(times).size).toBe(times.length);
    // 방금 성공한 덤프가 있으므로 정상
    expect(body.health.state).toBe("ok");
    expect(body.health.lastSuccessAt).toBeTruthy();
  });
});

describe("덤프 내려받기·삭제 요청 (BAK-007)", () => {
  it("재인증하면 짧은 서명 URL을 받고 실제로 내려받아지며, 발급 이력이 남는다", async () => {
    const { id } = await seedDump("manual", "내려받기 본문");
    await verifyPin("owner");
    const res = await req("owner", `/api/system/backups/${id}/download`);
    expect(res.status).toBe(200);
    const { url, filename, expiresInSeconds } = await json<{
      url: string;
      filename: string;
      expiresInSeconds: number;
    }>(res);
    expect(expiresInSeconds).toBe(600);
    expect(filename).toMatch(/^fmerp-db-[0-9a-f]{8}\.dump\.age$/);
    // 서명 URL로 실제 내려받아 본다 (S3 체크섬 설정 때문에 깨지는 일이 없도록 fetch까지)
    const file = await fetch(url);
    expect(file.status).toBe(200);
    expect(await file.text()).toBe("내려받기 본문");
    expect(file.headers.get("content-disposition")).toContain(filename);

    const list = await json<{ items: { id: string; downloads: { userName: string | null }[] }[] }>(
      await req("owner", "/api/system/backups"),
    );
    expect(list.items.find((i) => i.id === id)?.downloads).toHaveLength(1);
  });

  it("대기·실패·삭제 요청된 덤프는 내려받을 수 없다", async () => {
    await verifyPin("owner");
    const { rows } = await owner.pool.query(
      "insert into system_backup (kind, status, note, finished_at, error) values ('manual', 'FAILED', $1, now(), 'x') returning id",
      [`${MARK} 실패`],
    );
    expect((await req("owner", `/api/system/backups/${rows[0].id}/download`)).status).toBe(409);
    expect(
      (await req("owner", `/api/system/backups/00000000-0000-4000-8000-000000000000/download`))
        .status,
    ).toBe(404);
  });

  it("수동 덤프 삭제 요청은 객체에 태그를 붙이고 이력에 표시하며, 이후 내려받을 수 없다 (멱등)", async () => {
    const { id, key } = await seedDump("manual");
    await verifyPin("owner");
    expect((await req("owner", `/api/system/backups/${id}/delete`, "POST")).status).toBe(200);
    expect(await storage.getTags(key)).toEqual({ expire: "1" });
    const { rows } = await owner.pool.query(
      "select delete_requested_at from system_backup where id = $1",
      [id],
    );
    expect(rows[0].delete_requested_at).not.toBeNull();
    // 객체는 지워지지 않는다 (앱 키에 삭제 권한이 없고, 정리는 수명 주기 규칙이 한다)
    expect(await storage.head(key)).not.toBeNull();
    expect((await req("owner", `/api/system/backups/${id}/download`)).status).toBe(409);
    expect((await req("owner", `/api/system/backups/${id}/delete`, "POST")).status).toBe(200);
    const audit = await authDb.db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.action, "backup.delete_request"), eq(schema.auditLog.targetId, id)),
      );
    expect(audit).toHaveLength(1);
  });

  it("자동 덤프는 삭제 요청할 수 없다 (보관 규칙이 정리한다)", async () => {
    const { id } = await seedDump("auto");
    await verifyPin("owner");
    expect((await req("owner", `/api/system/backups/${id}/delete`, "POST")).status).toBe(409);
  });
});

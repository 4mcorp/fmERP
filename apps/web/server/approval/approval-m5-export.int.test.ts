// M5-C2 통합 테스트: 문서 목록 내보내기 (APV-083) — CSV·엑셀, 열람 범위, 수식 주입 방어, 10,000건 상한, 감사 로그 (실제 DB)
import { createDatabase, schema, withTenant } from "@fmerp/db";
import { json, loginAs, type TestClient } from "@fmerp/shared/testing/test-client";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { csvCell } from "./export";

const authDb = createDatabase(process.env.AUTH_DATABASE_URL ?? "");
const appDb = createDatabase(process.env.DATABASE_URL ?? "");
afterAll(async () => {
  await authDb.pool.end();
  await appDb.pool.end();
});

let accountId: string;
let businessId: string;
let ids: Record<string, string>;
let generalFormId: string;
const clients: Record<string, TestClient> = {};
const TAG = `exp${Math.random().toString(36).slice(2, 7)}`;
const req = (who: string, path: string, method = "GET", body?: unknown) =>
  (clients[who] as TestClient).request(path, {
    method,
    body: body === undefined && method !== "GET" ? {} : body,
  });
const DOC = { type: "doc", content: [] };

async function createSubmitted(title: string) {
  const res = await req("member1", "/api/approvals", "POST", {
    businessId,
    formId: generalFormId,
    title,
    body: { body: DOC },
    line: [
      {
        type: "approve",
        seq: 1,
        target: { kind: "user", membershipId: ids["member2@example.com"] },
      },
    ],
  });
  if (res.status !== 201) throw new Error(`생성 실패 ${res.status} ${await res.text()}`);
  const { documentId } = await json<{ documentId: string }>(res);
  const s = await req("member1", `/api/approvals/${documentId}/submit`, "POST");
  if (s.status !== 200) throw new Error(`상신 실패 ${s.status} ${await s.text()}`);
  return documentId;
}

const csvOf = async (who: string, query: string) => {
  const res = await req(who, `/api/search/export?format=csv&${query}`);
  return { res, text: res.status === 200 ? await res.text() : await res.clone().text() };
};

beforeAll(async () => {
  for (const who of ["member1", "member2", "hr", "owner", "owner-b"]) {
    clients[who] = await loginAs(`${who}@example.com`);
  }
  const [account] = await authDb.db
    .select()
    .from(schema.account)
    .where(eq(schema.account.slug, "fourm-test"));
  accountId = account?.id ?? "";
  const members = await authDb.db
    .select({
      id: schema.membership.id,
      email: schema.user.email,
      accountId: schema.membership.accountId,
    })
    .from(schema.membership)
    .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId));
  ids = Object.fromEntries(
    members.filter((x) => x.accountId === accountId).map((x) => [x.email, x.id]),
  );
  const businesses = await withTenant(appDb.db, accountId, (tx) =>
    tx.select().from(schema.business),
  );
  businessId = businesses.find((b) => b.code === "FM")?.id ?? "";
  const forms = await json<{ id: string; code: string }[]>(await req("member1", "/api/forms"));
  generalFormId = forms.find((f) => f.code === "GENERAL")?.id ?? "";
});

describe("csvCell 수식 주입 방어", () => {
  it("엑셀이 수식으로 실행할 수 있는 시작 글자 앞에 작은따옴표를 붙인다", () => {
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)", "\t=1", "\r=1"]) {
      expect(csvCell(bad).replace(/^"/, "").startsWith("'"), JSON.stringify(bad)).toBe(true);
    }
    expect(csvCell("일반 제목")).toBe("일반 제목");
  });

  it("쉼표·따옴표·줄바꿈은 따옴표로 감싸 이스케이프한다", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
});

describe("내보내기 (APV-083)", () => {
  it("검색 조건에 맞는 문서를 CSV로 내려주고 한글이 깨지지 않게 BOM을 붙인다", async () => {
    await createSubmitted(`${TAG} 출장비 정산`);
    await createSubmitted(`${TAG} 비품 구매`);
    const { res, text } = await csvOf("member1", `q=${encodeURIComponent(`${TAG} 출장비`)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("UTF-8''");
    // fetch의 text()는 BOM을 떼므로 BOM은 원시 바이트로 확인한다
    const raw = new Uint8Array(
      await (
        await req(
          "member1",
          `/api/search/export?format=csv&q=${encodeURIComponent(`${TAG} 출장비`)}`,
        )
      ).arrayBuffer(),
    );
    expect([...raw.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text.startsWith("문서번호,제목,기안자,상태,긴급,보안등급,상신일시,완료일시\r\n")).toBe(
      true,
    );
    const lines = text.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`${TAG} 출장비 정산`);
    expect(lines[1]).toContain("박사원");
    expect(lines[1]).toContain("진행 중");
    expect(lines[1]).not.toContain("비품");
  });

  it("제목이 수식처럼 보이면 CSV 칸을 글자로 만든다", async () => {
    await createSubmitted(`=HYPERLINK("http://evil","${TAG}")`);
    const { text } = await csvOf("member1", `q=${encodeURIComponent(`${TAG}`)}&status=IN_PROGRESS`);
    const body = text.split("\r\n").find((l) => l.includes("HYPERLINK")) ?? "";
    // 두 번째 칸(제목)이 작은따옴표로 시작하고 따옴표로 감싸졌다
    expect(body).toContain(`"'=HYPERLINK(""http://evil"",""${TAG}"")"`);
  });

  it("엑셀(xlsx)로도 내려준다", async () => {
    const res = await req(
      "member1",
      `/api/search/export?format=xlsx&q=${encodeURIComponent(`${TAG} 출장비`)}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)).toBe("PK");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("열람 권한이 없는 문서는 내보내지 않는다", async () => {
    const { text: member2 } = await csvOf("member2", `q=${encodeURIComponent(`${TAG} 출장비`)}`);
    expect(member2.trim().split("\r\n")).toHaveLength(2); // 결재자는 본다
    const { text: hr } = await csvOf("hr", `q=${encodeURIComponent(`${TAG} 출장비`)}`);
    expect(hr.trim().split("\r\n")).toHaveLength(1); // 머리글만
    const { text: other } = await csvOf("owner-b", `q=${encodeURIComponent(`${TAG} 출장비`)}`);
    expect(other.trim().split("\r\n")).toHaveLength(1);
  });

  it("내보낸 사실을 감사 로그에 남기되 검색어 자체는 남기지 않는다", async () => {
    await csvOf("member1", `q=${encodeURIComponent(`${TAG} 출장비`)}&status=IN_PROGRESS`);
    const logs = await withTenant(appDb.db, accountId, (tx) =>
      tx.select().from(schema.auditLog).where(eq(schema.auditLog.action, "document.export")),
    );
    const mine = logs.filter((l) => l.reason?.includes("status"));
    expect(mine.length).toBeGreaterThan(0);
    const reason = mine[mine.length - 1]?.reason ?? "";
    expect(reason).toMatch(/^CSV \d+건 \(조건: .*q.*status.*\)$/);
    expect(reason).not.toContain(TAG);
  });

  it("10,000건을 넘으면 거부하고 조건을 좁히게 안내한다", async () => {
    const COMMON = `대량${TAG}`;
    await withTenant(appDb.db, accountId, (tx) =>
      tx.execute(sql`insert into document (id, account_id, business_id, drafter_membership_id, title, status, policy, submitted_at)
        select uuidv7(), ${accountId}::uuid, ${businessId}::uuid, ${ids["member1@example.com"]}::uuid,
               ${COMMON} || ' ' || g, 'IN_PROGRESS',
               '{"disagree":"reject","rejectTo":"drafter","auditCanReject":true}'::jsonb, now()
        from generate_series(1, 10001) g`),
    );
    const { res } = await csvOf("member1", `q=${encodeURIComponent(COMMON)}`);
    expect(res.status).toBe(400);
    expect((await res.json()).title).toContain("10,000건");
  }, 120_000);

  it("잘못된 형식·조건은 400, 로그인하지 않으면 401이다", async () => {
    expect((await req("member1", "/api/search/export?format=pdf")).status).toBe(400);
    expect((await req("member1", "/api/search/export?status=NOPE")).status).toBe(400);
    const { app } = await import("../app");
    expect((await app.request("/api/search/export")).status).toBe(401);
  });
});

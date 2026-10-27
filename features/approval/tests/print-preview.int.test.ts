// 출력 미리보기 통합 테스트 (계획 2.3): 열람 권한(404)·상신 전(409)·상신 후 HTML(200), 저장하지 않음 (실제 DB)
import { createDatabase, schema, withTenant } from "@fmerp/db";
import { loginAs, type TestClient } from "@fmerp/shared/testing/test-client";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const authDb = createDatabase(process.env.AUTH_DATABASE_URL ?? "");
const appDb = createDatabase(process.env.DATABASE_URL ?? "");
afterAll(async () => {
  await authDb.pool.end();
  await appDb.pool.end();
});

let accountId: string;
let businessId: string;
let generalFormId: string;
let memberIds: Record<string, string>;
const clients: Record<string, TestClient> = {};
const DOC = { type: "doc", content: [] };

const req = (who: string, path: string, method = "GET", body?: unknown) =>
  (clients[who] as TestClient).request(path, {
    method,
    body: body === undefined && method !== "GET" ? {} : body,
  });

async function createDoc() {
  const res = await req("member1", "/api/approvals", "POST", {
    businessId,
    formId: generalFormId,
    title: "출력 미리보기 시험",
    body: { body: DOC },
    line: [{ type: "approve", seq: 1, target: { kind: "user", membershipId: memberIds.member2 } }],
  });
  if (res.status !== 201) throw new Error(`문서 생성 실패 ${res.status} ${await res.text()}`);
  return ((await res.json()) as { documentId: string }).documentId;
}

async function submit(id: string) {
  const res = await req("member1", `/api/approvals/${id}/submit`, "POST");
  if (res.status !== 200) throw new Error(`상신 실패 ${res.status} ${await res.text()}`);
}

const preview = (who: string, id: string) => req(who, `/api/approvals/${id}/print-preview`);

beforeAll(async () => {
  for (const who of ["member1", "member2", "multi", "admin", "bizadmin", "hr", "approver"]) {
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
  memberIds = Object.fromEntries(
    members
      .filter((x) => x.accountId === accountId)
      .map((x) => [x.email.split("@")[0] as string, x.id]),
  );
  const businesses = await withTenant(appDb.db, accountId, (tx) =>
    tx.select().from(schema.business),
  );
  businessId = businesses.find((b) => b.code === "FM")?.id ?? "";
  const forms = (await (await req("member1", "/api/forms")).json()) as {
    id: string;
    code: string;
  }[];
  generalFormId = forms.find((f) => f.code === "GENERAL")?.id ?? "";
});

describe("출력 미리보기 응답 (계획 2.3)", () => {
  it("상신 전 문서는 기안자도 미리볼 수 없다 (409)", async () => {
    const id = await createDoc();
    expect((await preview("member1", id)).status).toBe(409);
  });

  it("열람 권한이 없는 사람에게는 문서가 있는지도 알려 주지 않는다 (404)", async () => {
    const id = await createDoc();
    await submit(id);
    for (const who of ["multi", "admin", "bizadmin", "hr", "approver"]) {
      expect((await preview(who, id)).status, who).toBe(404);
    }
  });

  it("상신 후 기안자와 결재자는 완료 전 HTML을 받고 진행 중 표시가 들어 있다 (200)", async () => {
    const id = await createDoc();
    await submit(id);
    for (const who of ["member1", "member2"]) {
      const res = await preview(who, id);
      expect(res.status, who).toBe(200);
      expect(res.headers.get("content-type"), who).toContain("text/html");
      const html = await res.text();
      expect(html, who).toContain("출력 미리보기 시험");
      expect(html, who).toContain("결재 진행 중 (미완료)");
    }
  });

  it("응답 헤더 X-Print-Orientation은 양식 layout 방향(기본 portrait)을 알린다", async () => {
    const id = await createDoc();
    await submit(id);
    const res = await preview("member1", id);
    expect(res.status).toBe(200);
    // 이 테스트 양식(GENERAL)은 layout.orientation이 없어 portrait다. landscape 분기는 print-preview.test.ts의 단위 테스트가 맡는다
    expect(res.headers.get("x-print-orientation")).toBe("portrait");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("미리보기는 저장하지 않는다: 인쇄 기록과 본문 리비전이 늘지 않는다", async () => {
    const id = await createDoc();
    await submit(id);
    const countRows = async () =>
      withTenant(appDb.db, accountId, async (tx) => ({
        prints: (
          await tx
            .select({ id: schema.auditLog.id })
            .from(schema.auditLog)
            .where(eq(schema.auditLog.targetId, id))
        ).length,
        revisions: (
          await tx
            .select({ id: schema.documentRevision.id })
            .from(schema.documentRevision)
            .where(eq(schema.documentRevision.documentId, id))
        ).length,
      }));
    const before = await countRows();
    expect((await preview("member1", id)).status).toBe(200);
    const after = await countRows();
    expect(after.revisions).toBe(before.revisions);
    expect(after.prints).toBe(before.prints);
  });
});

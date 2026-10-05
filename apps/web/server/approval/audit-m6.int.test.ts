// M6 통합 테스트: 감사 단계 대상(AUD-001), 감사인 열람 기록(AUD-010), 타임라인(AUD-011), 감사 로그 조회(AUD-025), 월간 점검(AUD-026) (실제 DB)
import { createDatabase, schema, withTenant } from "@fmerp/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, loginAs, type TestClient } from "../test-client";

const authDb = createDatabase(process.env.AUTH_DATABASE_URL ?? "");
const appDb = createDatabase(process.env.DATABASE_URL ?? "");
afterAll(async () => {
  await authDb.pool.end();
  await appDb.pool.end();
});

let accountId: string;
let businessId: string;
let mgtDepartmentId: string;
let ids: Record<string, string>;
let generalFormId: string;
const clients: Record<string, TestClient> = {};
const DOC = { type: "doc", content: [] };
let keySeq = 0;
const key = () => `m6-${++keySeq}-${Math.random().toString(36).slice(2)}`;
const req = (who: string, path: string, method = "GET", body?: unknown) =>
  (clients[who] as TestClient).request(path, {
    method,
    body: body === undefined && method !== "GET" ? {} : body,
  });

interface View {
  status: string;
  steps: { id: string; status: string; version: number }[];
}
interface RecipientView {
  id: string;
  kind: string;
  targetName: string;
  receivedByName: string | null;
  reads: { name: string }[];
  distributedTo: { name: string }[];
}

const approveStep = (seq: number, email: string) => ({
  type: "approve",
  seq,
  target: { kind: "user", membershipId: ids[email] },
});

async function createDoc(over: Record<string, unknown> = {}) {
  const res = await req("member1", "/api/approvals", "POST", {
    businessId,
    formId: generalFormId,
    title: "M6 감사 테스트",
    body: { body: DOC },
    line: [approveStep(1, "member2@example.com")],
    ...over,
  });
  if (res.status !== 201) throw new Error(`문서 생성 실패 ${res.status} ${await res.text()}`);
  return (await json<{ documentId: string }>(res)).documentId;
}
const status = async (who: string, id: string) => (await req(who, `/api/approvals/${id}`)).status;
const recipients = async (who: string, id: string) =>
  json<RecipientView[]>(await req(who, `/api/approvals/${id}/recipients`));

async function setRecipients(id: string, items: unknown[]) {
  const res = await req("member1", `/api/approvals/${id}/recipients`, "PUT", { items });
  expect(res.status).toBe(200);
}
async function submit(id: string) {
  const res = await req("member1", `/api/approvals/${id}/submit`, "POST");
  if (res.status !== 200) throw new Error(`상신 실패 ${res.status} ${await res.text()}`);
}
async function complete(id: string) {
  const v = await json<View>(await req("member1", `/api/approvals/${id}`));
  const step = v.steps.find((s) => s.status === "ACTIVE");
  const res = await req("member2", `/api/approvals/${id}/steps/${step?.id}/act`, "POST", {
    action: { kind: "approve" },
    idempotencyKey: key(),
    expectedVersion: step?.version,
  });
  if (res.status !== 200) throw new Error(`승인 실패 ${res.status} ${await res.text()}`);
}

const member = (email: string) => ({ type: "member", id: ids[email] });
const dept = () => ({ type: "department", id: mgtDepartmentId });

beforeAll(async () => {
  for (const who of [
    "member1",
    "member2",
    "hr",
    "admin",
    "owner",
    "auditor",
    "bizadmin",
    "approver",
    "multi",
    "owner-b",
  ]) {
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
  const departments = await withTenant(appDb.db, accountId, (tx) =>
    tx.select().from(schema.department),
  );
  mgtDepartmentId =
    departments.find((d) => d.businessId === businessId && d.code === "MGT")?.id ?? "";
  const forms = await json<{ id: string; code: string }[]>(await req("member1", "/api/forms"));
  generalFormId = forms.find((f) => f.code === "GENERAL")?.id ?? "";
  for (const who of ["member1", "member2"]) {
    await req(who, "/api/me/pin", "PUT", { pin: "246810" });
    expect((await req(who, "/api/me/pin/verify", "POST", { pin: "246810" })).status).toBe(200);
  }
});

describe("감사 단계 대상 (AUD-001)", () => {
  const auditStep = (email: string) => ({
    type: "audit",
    seq: 2,
    target: { kind: "user", membershipId: ids[email] },
  });

  it("감사인 역할이 없는 구성원을 감사 단계에 넣으면 거부한다", async () => {
    const res = await req("member1", "/api/approvals", "POST", {
      businessId,
      formId: generalFormId,
      title: "감사 단계 대상 검증",
      body: { body: DOC },
      line: [approveStep(1, "member2@example.com"), auditStep("approver@example.com")],
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("감사인");
  });

  it("감사인 역할 보유자는 감사 단계에 넣을 수 있다", async () => {
    const id = await createDoc({
      line: [approveStep(1, "member2@example.com"), auditStep("auditor@example.com")],
    });
    expect(id).toBeTruthy();
  });
});

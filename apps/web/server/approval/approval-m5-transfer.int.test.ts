// M5-A4 통합 테스트: 결재자 일괄 이관(ADM-005), 진행 중 결재 검사(ORG-005·015·036), 장기 미처리 목록 (실제 DB)
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
let finDepartmentId: string;
let ids: Record<string, string>;
let generalFormId: string;
const clients: Record<string, TestClient> = {};
const DOC = { type: "doc", content: [] };
let keySeq = 0;
const key = () => `m5t-${++keySeq}-${Math.random().toString(36).slice(2)}`;
const req = (who: string, path: string, method = "GET", body?: unknown) =>
  (clients[who] as TestClient).request(path, {
    method,
    body: body === undefined && method !== "GET" ? {} : body,
  });
const PIN = "246810";

interface View {
  status: string;
  steps: {
    id: string;
    status: string;
    version: number;
    assignees: { membershipId?: string; name?: string }[];
  }[];
}

const approveStep = (seq: number, email: string) => ({
  type: "approve",
  seq,
  target: { kind: "user", membershipId: ids[email] },
});
const view = async (id: string) => json<View>(await req("member1", `/api/approvals/${id}`));

async function createSubmitted(line: unknown[], title = "이관 테스트") {
  const res = await req("member1", "/api/approvals", "POST", {
    businessId,
    formId: generalFormId,
    title,
    body: { body: DOC },
    line,
  });
  if (res.status !== 201) throw new Error(`문서 생성 실패 ${res.status} ${await res.text()}`);
  const { documentId } = await json<{ documentId: string }>(res);
  const s = await req("member1", `/api/approvals/${documentId}/submit`, "POST");
  if (s.status !== 200) throw new Error(`상신 실패 ${s.status} ${await s.text()}`);
  return documentId;
}

const transfer = (who: string, from: string, to: string, reason = "퇴사 인수인계") =>
  req(who, "/api/approval-admin/transfer", "POST", {
    fromMembershipId: ids[`${from}@example.com`],
    toMembershipId: ids[`${to}@example.com`],
    reason,
  });

async function setPin(who: string) {
  await req(who, "/api/me/pin", "PUT", { pin: PIN });
  expect((await req(who, "/api/me/pin/verify", "POST", { pin: PIN })).status).toBe(200);
}

beforeAll(async () => {
  for (const who of [
    "member1",
    "member2",
    "hr",
    "admin",
    "owner",
    "approver",
    "bizadmin",
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
  finDepartmentId = departments.find((d) => d.code === "FIN")?.id ?? "";
  const forms = await json<{ id: string; code: string }[]>(await req("member1", "/api/forms"));
  generalFormId = forms.find((f) => f.code === "GENERAL")?.id ?? "";
  // approver(결재 관리자)는 재인증이 필요하다
  for (const who of ["member1", "member2", "hr", "approver"]) await setPin(who);
});

describe("결재자 일괄 이관 (ADM-005)", () => {
  it("처리 전 단계를 모두 대체 결재자에게 넘기고, 새 처리자가 승인할 수 있다", async () => {
    const a = await createSubmitted([approveStep(1, "member2@example.com")], "이관 A");
    const b = await createSubmitted(
      [approveStep(1, "hr@example.com"), approveStep(2, "member2@example.com")],
      "이관 B",
    );
    const res = await transfer("approver", "member2", "bizadmin");
    expect(res.status).toBe(200);
    const body = await json<{ documents: number; steps: number }>(res);
    expect(body.documents).toBeGreaterThanOrEqual(2);
    expect(body.steps).toBeGreaterThanOrEqual(2);

    // 이전 처리자는 더 이상 참여자가 아니다 (대결 이외에는 404)
    expect((await req("member2", `/api/approvals/${a}`)).status).toBe(404);
    const va = await view(a);
    expect(va.steps[0]?.assignees.map((x) => x.name)).toEqual(["오사업"]);
    expect((await req("bizadmin", `/api/approvals/${b}`)).status).toBe(200);

    // 새 처리자(bizadmin)가 승인한다
    await setPin("bizadmin");
    const active = va.steps.find((s) => s.status === "ACTIVE");
    const done = await req("bizadmin", `/api/approvals/${a}/steps/${active?.id}/act`, "POST", {
      action: { kind: "approve" },
      idempotencyKey: key(),
      expectedVersion: active?.version,
    });
    expect(done.status).toBe(200);
    expect((await view(a)).status).toBe("COMPLETED");
  });

  it("이관 전 version으로 요청한 이전 처리자의 승인은 충돌한다", async () => {
    const id = await createSubmitted([approveStep(1, "hr@example.com")], "version 충돌");
    const before = (await view(id)).steps[0];
    expect((await transfer("approver", "hr", "member2")).status).toBe(200);
    const stale = await req("member2", `/api/approvals/${id}/steps/${before?.id}/act`, "POST", {
      action: { kind: "approve" },
      idempotencyKey: key(),
      expectedVersion: before?.version,
    });
    expect(stale.status).toBe(409);
  });

  it("처리된 단계와 완료된 문서는 건드리지 않는다", async () => {
    const done = await createSubmitted([approveStep(1, "member2@example.com")], "완료 문서");
    const step = (await view(done)).steps[0];
    await req("member2", `/api/approvals/${done}/steps/${step?.id}/act`, "POST", {
      action: { kind: "approve" },
      idempotencyKey: key(),
      expectedVersion: step?.version,
    });
    expect((await view(done)).status).toBe("COMPLETED");
    await transfer("approver", "member2", "hr");
    const after = await view(done);
    expect(after.steps[0]?.assignees[0]?.name).toBe("최대리");
  });

  it("사유가 없거나 같은 사람·퇴사자에게 이관할 수 없다", async () => {
    expect((await transfer("approver", "member2", "hr", "   ")).status).toBe(400);
    expect((await transfer("approver", "member2", "member2")).status).toBe(400);
    const left = await req("approver", "/api/approval-admin/transfer", "POST", {
      fromMembershipId: ids["member2@example.com"],
      toMembershipId: ids["left@example.com"],
      reason: "퇴사자에게",
    });
    expect(left.status).toBe(400);
  });

  it("결재 관리 권한이 없으면 처리할 문서가 있을 때 거부된다", async () => {
    await createSubmitted([approveStep(1, "hr@example.com")], "권한 확인");
    // 일반 구성원 member1은 결재 관리자가 아니다 (재인증은 통과해도 권한 부족)
    expect((await transfer("member1", "hr", "member2")).status).toBe(403);
    // 계정 관리자(admin)는 결재 관리 권한이 있지만 PIN 재인증이 없으면 428
    expect((await transfer("admin", "hr", "member2")).status).toBe(428);
  });

  it("다른 회사 사용자는 우리 회사 구성원을 이관할 수 없고 문서도 바뀌지 않는다", async () => {
    const id = await createSubmitted([approveStep(1, "hr@example.com")], "다른 회사 침투");
    await setPin("owner-b");
    const res = await req("owner-b", "/api/approval-admin/transfer", "POST", {
      fromMembershipId: ids["hr@example.com"],
      toMembershipId: ids["member2@example.com"],
      reason: "침투",
    });
    // 상대 회사 구성원은 존재하지 않는 것처럼 대체 결재자 검증에서 거부된다
    expect(res.status).toBe(400);
    expect((await view(id)).steps[0]?.assignees[0]?.name).toBe("송인사");
    const overdue = await json<unknown[]>(
      await req("owner-b", "/api/approval-admin/overdue?days=0"),
    );
    expect(overdue).toEqual([]);
  });

  it("로그인하지 않으면 401이다", async () => {
    const { app } = await import("../app");
    expect((await app.request("/api/approval-admin/overdue")).status).toBe(401);
  });
});

describe("진행 중 결재 검사 (ORG-005·015·036)", () => {
  it("처리 전 결재가 있는 구성원은 퇴사·휴직 처리할 수 없고 이관 뒤에는 가능하다", async () => {
    await createSubmitted([approveStep(1, "hr@example.com")], "퇴사 검사");
    const userId = (
      await authDb.db
        .select({ userId: schema.membership.userId })
        .from(schema.membership)
        .where(eq(schema.membership.id, ids["hr@example.com"] ?? ""))
    )[0]?.userId;
    const blocked = await req("owner", `/api/account/members/${userId}`, "PATCH", {
      status: "leave",
    });
    expect(blocked.status).toBe(409);
    const problem = await json<{ code: string; detail?: string; title?: string }>(blocked);
    expect(problem.code).toBe("in_flight");
    expect(await transfer("approver", "hr", "member2")).toHaveProperty("status", 200);
    const ok = await req("owner", `/api/account/members/${userId}`, "PATCH", { status: "leave" });
    expect(ok.status).toBe(200);
    // 복직은 막지 않는다
    expect(
      (await req("owner", `/api/account/members/${userId}`, "PATCH", { status: "active" })).status,
    ).toBe(200);
  });

  it("사업자 비활성화·부서 폐지는 진행 중 결재가 있으면 409 in_flight로 거부된다", async () => {
    await createSubmitted([approveStep(1, "member2@example.com")], "부서 폐지 검사");
    // member2(재무팀)가 처리 전 단계에 걸려 있으므로 재무팀(과 그 상위 부서)은 폐지할 수 없다
    const dept = await req("owner", `/api/departments/${finDepartmentId}/deactivate`, "POST");
    expect(dept.status).toBe(409);
    expect((await json<{ code: string }>(dept)).code).toBe("in_flight");
    // 이 사업자에는 진행 중 문서가 있어 비활성화할 수 없다
    const biz = await req("owner", `/api/businesses/${businessId}/deactivate`, "POST");
    expect(biz.status).toBe(409);
    expect((await json<{ code: string }>(biz)).code).toBe("in_flight");
  });

  it("진행 중 결재가 없는 부서는 폐지할 수 있다", async () => {
    // 물류팀(다른 사업자)에는 결재선에 걸린 사람이 없다
    const departments = await withTenant(appDb.db, accountId, (tx) =>
      tx.select().from(schema.department),
    );
    const idle = departments.find((d) => d.code === "LOG");
    const off = await req("owner", `/api/departments/${idle?.id}/deactivate`, "POST");
    expect(off.status).toBe(200);
    expect((await req("owner", `/api/departments/${idle?.id}/activate`, "POST")).status).toBe(200);
  });
});

describe("장기 미처리 목록 (ADM-005)", () => {
  it("결재 관리자는 N일 지난 진행 중 문서를 보고, 일반 구성원은 빈 목록이다", async () => {
    const id = await createSubmitted([approveStep(1, "hr@example.com")], "오래된 문서");
    // 마지막 변경 시각을 10일 전으로 돌린다 (소유 계정의 직접 UPDATE는 앱 계정에 허용된 컬럼)
    await withTenant(appDb.db, accountId, (tx) =>
      tx
        .update(schema.document)
        .set({ updatedAt: new Date(Date.now() - 10 * 86_400_000) })
        .where(eq(schema.document.id, id)),
    );
    const rows = await json<{ id: string; waitingDays: number; waiting: unknown[] }[]>(
      await req("approver", "/api/approval-admin/overdue?days=7"),
    );
    const mine = rows.find((r) => r.id === id);
    expect(mine?.waitingDays).toBeGreaterThanOrEqual(10);
    expect(mine?.waiting).toHaveLength(1);
    // 결재 관리 권한이 없으면 빈 목록이 아니라 403이다
    expect((await req("member1", "/api/approval-admin/overdue?days=7")).status).toBe(403);
    expect(
      (
        await json<{ id: string }[]>(await req("approver", "/api/approval-admin/overdue?days=30"))
      ).some((r) => r.id === id),
    ).toBe(false);
  });
});

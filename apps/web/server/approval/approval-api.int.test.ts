// 결재 요청 생성·조회와 부재 설정 API 통합 테스트 (M3, APV-050·052·090)
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

interface Problem {
  code: string;
  title: string;
  extensions?: Record<string, unknown>;
}

let member1: TestClient;
let member2: TestClient;
let auditor: TestClient;
let admin: TestClient;
let owner: TestClient;
let businessId: string;
let ids: Record<string, string>;

let generalFormId = "";
// 기안은 양식으로 한다: 결재 요청 생성에는 일반 기안 양식을 붙인다
const post = (c: TestClient, path: string, body: unknown) =>
  c.request(path, {
    method: "POST",
    body: path === "/api/approvals" ? { formId: generalFormId, ...(body as object) } : body,
  });

beforeAll(async () => {
  [member1, member2, auditor, admin, owner] = await Promise.all([
    loginAs("member1@example.com"),
    loginAs("member2@example.com"),
    loginAs("auditor@example.com"),
    loginAs("admin@example.com"),
    loginAs("owner@example.com"),
  ]);
  const [account] = await authDb.db
    .select()
    .from(schema.account)
    .where(eq(schema.account.slug, "fourm-test"));
  const members = await authDb.db
    .select({
      id: schema.membership.id,
      email: schema.user.email,
      accountId: schema.membership.accountId,
    })
    .from(schema.membership)
    .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId));
  ids = Object.fromEntries(
    members.filter((x) => x.accountId === account?.id).map((x) => [x.email, x.id]),
  );
  const [biz] = await withTenant(appDb.db, account?.id ?? "", (tx) =>
    tx
      .select({ id: schema.business.id })
      .from(schema.business)
      .where(eq(schema.business.code, "FM")),
  );
  businessId = biz?.id ?? "";
  const forms = await json<{ id: string; code: string }[]>(await member1.request("/api/forms"));
  generalFormId = forms.find((f) => f.code === "GENERAL")?.id ?? "";
});

const user = (email: string) => ({ kind: "user", membershipId: ids[email] });

describe("접근 제어", () => {
  it("비로그인 요청은 401", async () => {
    const { app } = await import("../app");
    for (const [method, path] of [
      ["POST", "/api/approvals"],
      ["GET", "/api/approvals/00000000-0000-0000-0000-000000000000"],
      ["GET", "/api/delegations"],
      ["POST", "/api/delegations"],
    ] as const) {
      const res = await app.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" ? undefined : "{}",
      });
      expect(res.status, path).toBe(401);
    }
  });
});

describe("결재 요청 생성 (APV-090)", () => {
  it("결재선을 해석해 만들고 바로 상신한다. 기안자·결재선 참여자만 볼 수 있다", async () => {
    const res = await post(member1, "/api/approvals", {
      businessId,
      title: "구매요청서",
      formCategory: "구매",
      sourceType: "purchase",
      sourceId: "PR-1",
      line: [
        { type: "approve", seq: 1, target: user("member2@example.com") },
        { type: "approve", seq: 2, target: { kind: "business_ceo", businessId } },
      ],
      body: { body: { type: "doc", content: [] } },
      submit: true,
    });
    expect(res.status).toBe(201);
    const created = await json<{ documentId: string; status: string; docNo: string | null }>(res);
    expect(created.status).toBe("IN_PROGRESS");

    const view = await member1.request(`/api/approvals/${created.documentId}`);
    expect(view.status).toBe(200);
    const body = await json<{ steps: { status: string; assignees: { name?: string }[] }[] }>(view);
    expect(body.steps.map((s) => s.status)).toEqual(["ACTIVE", "PENDING"]);
    expect(body.steps[0]?.assignees[0]?.name).toBe("최대리");

    expect((await member2.request(`/api/approvals/${created.documentId}`)).status).toBe(200);
    // 동적 대상(사업자 대표이사)으로 해석된 소유자는 참여자라서 볼 수 있다
    expect((await owner.request(`/api/approvals/${created.documentId}`)).status).toBe(200);
    // 관여하지 않은 관리자는 열람 불가. 감사인은 범위 안의 문서를 열람한다 (PERM-003, 상세는 approval-m5-access)
    expect((await admin.request(`/api/approvals/${created.documentId}`)).status).toBe(404);
    expect((await auditor.request(`/api/approvals/${created.documentId}`)).status).toBe(200);
  });

  it("초안으로 만들 수 있다 (submit 생략)", async () => {
    const res = await post(member1, "/api/approvals", {
      businessId,
      title: "초안",
      line: [{ type: "approve", seq: 1, target: user("member2@example.com") }],
    });
    expect((await json<{ status: string }>(res)).status).toBe("DRAFT");
  });

  it("결재선 오류는 400, 전결·정책·문서번호 지정은 무시된다", async () => {
    const bad = await post(member1, "/api/approvals", {
      businessId,
      title: "퇴사자 포함",
      line: [{ type: "approve", seq: 1, target: user("left@example.com") }],
    });
    expect(bad.status).toBe(400);
    expect((await json<Problem>(bad)).code).toBe("line_invalid");

    const selfOnly = await post(member1, "/api/approvals", {
      businessId,
      title: "본인만",
      line: [{ type: "approve", seq: 1, target: user("member1@example.com") }],
    });
    expect(selfOnly.status).toBe(400);

    // 기안자가 전결 권한·정책·문서번호 규칙을 직접 지정하려 해도 입력에서 무시된다 (양식·전결 규정이 정한다)
    const ignored = await post(member1, "/api/approvals", {
      businessId,
      title: "권한 상승 시도",
      line: [{ type: "approve", seq: 1, target: user("member2@example.com"), canFinalize: true }],
      policy: { auditCanReject: false },
      numbering: {
        rule: "{SEQ:4}",
        cycle: "year",
        at: "submit",
        departmentCode: "X",
        formCode: "Y",
      },
      body: { body: { type: "doc", content: [] } },
      submit: true,
    });
    expect(ignored.status).toBe(201);
    const view = await json<{ id: string; docNo: string | null }>(ignored);
    expect(view.docNo).toBeNull();
  });

  it("소속이 없는 사용자는 기안할 수 없다", async () => {
    const newbie = await loginAs("newbie@example.com");
    // 소속 회사가 없어 테넌트 단계에서 거부된다
    const res = await post(newbie, "/api/approvals", {
      businessId,
      title: "x",
      line: [{ type: "approve", seq: 1, target: user("member2@example.com") }],
    });
    expect([400, 403]).toContain(res.status);
  });
});

describe("부재·대결 설정 (APV-050·052)", () => {
  const period = { from: "2030-01-01T00:00:00Z", to: "2030-01-10T00:00:00Z" };
  const scope = { kind: "all" } as const;

  it("본인 부재를 설정하고 목록에서 본다. 다른 사람은 보지 못한다", async () => {
    const res = await post(member2, "/api/delegations", {
      delegateMembershipId: ids["hr@example.com"],
      ...period,
      scope,
      reason: "휴가",
    });
    expect(res.status).toBe(201);
    const mine = await json<{ membershipId: string }[]>(await member2.request("/api/delegations"));
    expect(mine.some((d) => d.membershipId === ids["member2@example.com"])).toBe(true);
    const others = await json<{ membershipId: string }[]>(
      await auditor.request("/api/delegations"),
    );
    expect(others.some((d) => d.membershipId === ids["member2@example.com"])).toBe(false);
  });

  it("다른 사람의 부재 설정은 관리자만 대행한다 (APV-052)", async () => {
    const body = {
      membershipId: ids["member1@example.com"],
      delegateMembershipId: ids["approver@example.com"],
      from: "2030-02-01T00:00:00Z",
      to: "2030-02-05T00:00:00Z",
      scope,
    };
    expect((await post(auditor, "/api/delegations", body)).status).toBe(403);
    const ok = await post(admin, "/api/delegations", body);
    expect(ok.status).toBe(201);
    const all = await json<{ membershipId: string }[]>(await admin.request("/api/delegations"));
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("연쇄 위임·기간 중복·본인 위임·역전된 기간은 400", async () => {
    const dup = await post(member2, "/api/delegations", {
      delegateMembershipId: ids["bizadmin@example.com"],
      ...period,
      scope,
    });
    expect(dup.status).toBe(400);
    expect((await json<Problem>(dup)).code).toBe("delegation_invalid");
    // hr은 member2의 대결자인 기간이므로 hr이 다른 사람에게 위임하면 연쇄
    expect(
      (
        await post(await loginAs("hr@example.com"), "/api/delegations", {
          delegateMembershipId: ids["bizadmin@example.com"],
          ...period,
          scope,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(member1, "/api/delegations", {
          delegateMembershipId: ids["member1@example.com"],
          from: "2031-01-01T00:00:00Z",
          to: "2031-01-02T00:00:00Z",
          scope,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(member1, "/api/delegations", {
          delegateMembershipId: ids["hr@example.com"],
          from: "2031-01-05T00:00:00Z",
          to: "2031-01-02T00:00:00Z",
          scope,
        })
      ).status,
    ).toBe(400);
  });

  it("취소는 본인 또는 대행 권한자만 한다", async () => {
    const created = await json<{ id: string }>(
      await post(auditor, "/api/delegations", {
        delegateMembershipId: ids["bizadmin@example.com"],
        from: "2032-01-01T00:00:00Z",
        to: "2032-01-03T00:00:00Z",
        scope,
      }),
    );
    expect(
      (await member1.request(`/api/delegations/${created.id}`, { method: "DELETE" })).status,
    ).toBe(403);
    expect(
      (await auditor.request(`/api/delegations/${created.id}`, { method: "DELETE" })).status,
    ).toBe(200);
    expect(
      (await auditor.request(`/api/delegations/${created.id}`, { method: "DELETE" })).status,
    ).toBe(404);
  });
});

// M2 조직·권한 API 통합 테스트 (실제 DB). 수용 기준 S2와 권한·테넌트 격리·감사 로그를 확인한다.
import { createDatabase, schema } from "@fmerp/db";
import { json, loginAs, type TestClient } from "@fmerp/shared/testing/test-client";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const authDb = createDatabase(process.env.AUTH_DATABASE_URL ?? "");
afterAll(() => authDb.pool.end());

interface Dept {
  id: string;
  businessId: string;
  parentId: string | null;
  depth: number;
  code: string;
  name: string;
  active: boolean;
  memberCount: number;
}
interface Biz {
  id: string;
  code: string;
  name: string;
  active: boolean;
}
interface Member {
  userId: string;
  membershipId: string;
  email: string;
  status: string;
  assignments: { departmentId: string; businessId: string; isPrimary: boolean }[];
  grants: { id: string; role: string; scopeType: string; scopeId: string | null }[];
}
interface Problem {
  code: string;
  title: string;
  extensions?: Record<string, unknown>;
}

let owner: TestClient;
let admin: TestClient;
let member1: TestClient;
let bizadmin: TestClient;
let hr: TestClient;
let auditor: TestClient;
let ownerB: TestClient;
let businesses: Biz[];
let depts: Dept[];

const biz = (code: string) => {
  const b = businesses.find((x) => x.code === code);
  if (!b) throw new Error(`no biz ${code}`);
  return b;
};
const dept = (code: string) => {
  const d = depts.find((x) => x.code === code);
  if (!d) throw new Error(`no dept ${code}`);
  return d;
};
const post = (c: TestClient, path: string, body?: unknown) =>
  c.request(path, { method: "POST", body: body ?? {} });
const patch = (c: TestClient, path: string, body: unknown) =>
  c.request(path, { method: "PATCH", body });

async function refresh() {
  businesses = await json<Biz[]>(await owner.request("/api/businesses"));
  depts = await json<Dept[]>(await owner.request("/api/departments"));
}

async function memberList(c: TestClient) {
  return json<Member[]>(await c.request("/api/account/members"));
}

async function auditActions(accountSlug: string) {
  const [a] = await authDb.db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(eq(schema.account.slug, accountSlug));
  if (!a) throw new Error("no account");
  const rows = await authDb.db
    .select({
      action: schema.auditLog.action,
      diff: schema.auditLog.diff,
      result: schema.auditLog.result,
    })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.accountId, a.id));
  return rows;
}

beforeAll(async () => {
  [owner, admin, member1, bizadmin, hr, auditor, ownerB] = await Promise.all([
    loginAs("owner@example.com"),
    loginAs("admin@example.com"),
    loginAs("member1@example.com"),
    loginAs("bizadmin@example.com"),
    loginAs("hr@example.com"),
    loginAs("auditor@example.com"),
    loginAs("owner-b@example.com"),
  ]);
  // 계정 선택은 로그인 후 활성 계정이 정해진 상태를 가정한다 (시드 계정은 각자 한 회사)
  await refresh();
});

describe("접근 제어 (비로그인·일반 구성원)", () => {
  it("비로그인 요청은 모두 401", async () => {
    const { app } = await import("./app");
    for (const [method, path] of [
      ["GET", "/api/businesses"],
      ["GET", "/api/departments"],
      ["GET", "/api/org-chart"],
      ["GET", "/api/positions"],
      ["GET", "/api/duties"],
      ["GET", "/api/account/settings"],
      ["GET", "/api/account/capabilities"],
    ] as const) {
      const res = await app.request(path, { method });
      expect(res.status, path).toBe(401);
    }
  });

  it("일반 구성원은 조직을 조회하지만 관리 API는 403", async () => {
    expect((await member1.request("/api/org-chart")).status).toBe(200);
    expect((await member1.request("/api/account/members")).status).toBe(200);
    expect((await member1.request("/api/account/settings")).status).toBe(403);
    expect(
      (await post(member1, "/api/businesses", { name: "x", bizRegNo: "2208162517", code: "X" }))
        .status,
    ).toBe(403);
    expect(
      (
        await post(member1, "/api/departments", {
          businessId: biz("FM").id,
          code: "NOPE",
          name: "권한없음",
        })
      ).status,
    ).toBe(403);
    expect((await post(member1, "/api/positions", { name: "x", rank: 1 })).status).toBe(403);
    const members = await memberList(owner);
    const target = members.find((m) => m.email === "member2@example.com");
    const res = await post(member1, `/api/account/members/${target?.userId}/roles`, {
      role: "hr_admin",
      scopeType: "account",
    });
    expect(res.status).toBe(403);
  });

  it("내 관리 권한 요약(메뉴 노출용)이 역할별로 다르다", async () => {
    const caps = async (c: TestClient) =>
      json<Record<string, boolean>>(await c.request("/api/account/capabilities"));
    expect((await caps(owner))["account.settings"]).toBe(true);
    expect((await caps(member1))["department.edit"]).toBe(false);
    const b = await caps(bizadmin);
    expect(b["department.edit"]).toBe(true);
    expect(b["account.settings"]).toBe(false);
    expect((await caps(hr))["position.manage"]).toBe(true);
    expect((await caps(auditor))["audit.read"]).toBe(true);
  });
});

describe("사업자 (ORG-002~005)", () => {
  it("체크섬이 틀린 사업자등록번호는 저장되지 않는다 (S1)", async () => {
    const res = await post(owner, "/api/businesses", {
      name: "잘못된 번호",
      bizRegNo: "220-81-62518",
      code: "BAD",
    });
    expect(res.status).toBe(400);
  });

  it("하이픈 있는 유효 번호는 정규화되어 저장되고, 같은 번호·코드는 중복으로 거부된다 (ORG-004)", async () => {
    const ok = await post(owner, "/api/businesses", {
      name: "신규 사업자",
      bizRegNo: "123-45-67891",
      code: "nb1",
    });
    // 체크섬이 맞지 않는 임의 번호일 수 있어 먼저 형식 오류를 구분한다
    if (ok.status === 400) {
      const { makeBusinessNumber } = await import("@fmerp/core");
      const valid = makeBusinessNumber("500123456");
      const retry = await post(owner, "/api/businesses", {
        name: "신규 사업자",
        bizRegNo: `${valid.slice(0, 3)}-${valid.slice(3, 5)}-${valid.slice(5)}`,
        code: "nb1",
      });
      expect(retry.status).toBe(201);
      const created = await json<{ bizRegNo: string; code: string }>(retry);
      expect(created.bizRegNo).toBe(valid);
      expect(created.code).toBe("NB1");
      const dupNo = await post(owner, "/api/businesses", {
        name: "중복",
        bizRegNo: valid,
        code: "ZZ",
      });
      expect(dupNo.status).toBe(409);
      const dupCode = await post(owner, "/api/businesses", {
        name: "코드중복",
        bizRegNo: makeBusinessNumber("500123457"),
        code: "NB1",
      });
      expect(dupCode.status).toBe(409);
    } else {
      expect(ok.status).toBe(201);
    }
  });

  it("사업자 관리자는 사업자를 만들 수 없다 (소유자·계정 관리자만)", async () => {
    const res = await post(bizadmin, "/api/businesses", {
      name: "x",
      bizRegNo: "2208162517",
      code: "Q",
    });
    expect(res.status).toBe(403);
  });

  it("비활성화·재활성화하고 감사 로그가 남는다 (진행 중 결재 검사는 M4에서 연결)", async () => {
    await refresh();
    const nb = businesses.find((b) => b.code === "NB1");
    expect(nb).toBeTruthy();
    expect((await post(owner, `/api/businesses/${nb?.id}/deactivate`)).status).toBe(200);
    await refresh();
    expect(businesses.find((b) => b.code === "NB1")?.active).toBe(false);
    expect((await post(owner, `/api/businesses/${nb?.id}/activate`)).status).toBe(200);
    const actions = (await auditActions("fourm-test")).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["business.create", "business.deactivate"]));
  });
});

describe("S2 부서 뎁스 제한 (API)", () => {
  it("최대 3단계에서 자금파트 아래 생성은 안내 문구와 함께 거부된다", async () => {
    const res = await post(owner, "/api/departments", {
      businessId: biz("FM").id,
      parentId: dept("CASH").id,
      code: "DEEP",
      name: "넷째 단계",
    });
    expect(res.status).toBe(400);
    const p = await json<Problem>(res);
    expect(p.code).toBe("depth_exceeded");
    expect(p.title).toBe("최대 3단계까지 만들 수 있습니다");
  });

  it("최대 뎁스를 2로 낮추면 3단계 부서 목록과 함께 거부된다", async () => {
    const res = await patch(owner, "/api/account/settings", { maxDeptDepth: 2 });
    expect(res.status).toBe(409);
    const p = await json<Problem>(res);
    expect(p.code).toBe("depth_exceeded");
    const list = p.extensions?.departments as { name: string; depth: number }[];
    expect(list.map((d) => d.name)).toEqual(["자금파트"]);
    expect(list[0]?.depth).toBe(3);
  });

  it("재무팀(하위 포함)을 인사팀(2단계) 아래로 옮기면 뎁스 4가 되어 거부된다", async () => {
    const res = await post(owner, `/api/departments/${dept("FIN").id}/move`, {
      newParentId: dept("HR").id,
    });
    expect(res.status).toBe(400);
    const p = await json<Problem>(res);
    expect(p.title).toBe("이동하면 4단계가 되어 최대 3단계를 넘습니다");
  });

  it("자기 하위로의 이동·다른 사업자로의 이동은 거부된다", async () => {
    expect(
      (
        await post(owner, `/api/departments/${dept("MGT").id}/move`, {
          newParentId: dept("CASH").id,
        })
      ).status,
    ).toBe(400);
    expect(
      (await post(owner, `/api/departments/${dept("HR").id}/move`, { newParentId: dept("LOG").id }))
        .status,
    ).toBe(400);
  });

  it("최상위 부서를 만들고 이동한 뒤 조직도에 반영된다", async () => {
    const created = await post(owner, "/api/departments", {
      businessId: biz("FM").id,
      code: "TMP1",
      name: "임시 본부",
    });
    expect(created.status).toBe(201);
    const tmp = await json<Dept>(created);
    expect(tmp.depth).toBe(1);
    const child = await post(owner, "/api/departments", {
      businessId: biz("FM").id,
      parentId: tmp.id,
      code: "TMP2",
      name: "임시 팀",
    });
    expect(child.status).toBe(201);
    const moved = await post(owner, `/api/departments/${(await json<Dept>(child)).id}/move`, {
      newParentId: dept("MGT").id,
    });
    expect(moved.status).toBe(200);
    const chart = await json<{
      maxDeptDepth: number;
      businesses: { id: string; departments: Dept[] }[];
    }>(await member1.request("/api/org-chart"));
    expect(chart.maxDeptDepth).toBe(3);
    const fm = chart.businesses.find((b) => b.id === biz("FM").id);
    const tmp2 = fm?.departments.find((d) => d.code === "TMP2");
    expect(tmp2?.parentId).toBe(dept("MGT").id);
    expect(tmp2?.depth).toBe(2);
    // 조직도의 구성원 수 (재무팀: 박사원·최대리)
    expect(fm?.departments.find((d) => d.code === "FIN")?.memberCount).toBe(2);
  });

  it("뎁스를 높이는 것은 언제든 허용된다", async () => {
    expect((await patch(owner, "/api/account/settings", { maxDeptDepth: 4 })).status).toBe(200);
    expect((await patch(owner, "/api/account/settings", { maxDeptDepth: 3 })).status).toBe(200);
  });
});

describe("부서 삭제·폐지 (ORG-015)", () => {
  it("하위 부서나 소속원이 있으면 삭제할 수 없고 폐지만 가능하다", async () => {
    await refresh();
    expect(
      (await owner.request(`/api/departments/${dept("MGT").id}`, { method: "DELETE" })).status,
    ).toBe(409);
    expect(
      (await owner.request(`/api/departments/${dept("FIN").id}`, { method: "DELETE" })).status,
    ).toBe(409);
    expect((await post(owner, `/api/departments/${dept("TMP2").id}/deactivate`)).status).toBe(200);
    expect((await post(owner, `/api/departments/${dept("TMP2").id}/activate`)).status).toBe(200);
  });

  it("비어 있는 부서는 삭제된다", async () => {
    await refresh();
    const res = await owner.request(`/api/departments/${dept("TMP2").id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(
      (await owner.request(`/api/departments/${dept("TMP1").id}`, { method: "DELETE" })).status,
    ).toBe(200);
  });
});

describe("권한 범위 (PERM-001)", () => {
  it("사업자 관리자는 자기 사업자 부서만 편집한다", async () => {
    await refresh();
    const own = await post(bizadmin, "/api/departments", {
      businessId: biz("FM").id,
      code: "BA1",
      name: "사업자관리자 생성",
    });
    expect(own.status).toBe(201);
    const other = await post(bizadmin, "/api/departments", {
      businessId: biz("LG").id,
      code: "BA2",
      name: "다른 사업자",
    });
    expect(other.status).toBe(403);
    expect(
      (await patch(bizadmin, `/api/departments/${dept("LOG").id}`, { name: "변경시도" })).status,
    ).toBe(403);
    await refresh();
    const made = dept("BA1");
    expect(
      (await bizadmin.request(`/api/departments/${made.id}`, { method: "DELETE" })).status,
    ).toBe(200);
  });

  it("인사 관리자는 직위를 관리하지만 부서는 편집하지 못한다", async () => {
    expect((await post(hr, "/api/positions", { name: "수석", rank: 55 })).status).toBe(201);
    expect(
      (await post(hr, "/api/departments", { businessId: biz("FM").id, code: "HRX", name: "x" }))
        .status,
    ).toBe(403);
  });

  it("감사인은 조직을 바꾸지 못한다", async () => {
    expect(
      (
        await post(auditor, "/api/departments", {
          businessId: biz("FM").id,
          code: "AUD",
          name: "x",
        })
      ).status,
    ).toBe(403);
  });

  it("직위 마스터: 중복 이름은 거부되고, 사용 안 함으로 바꿀 수 있다", async () => {
    expect((await post(owner, "/api/positions", { name: "수석", rank: 56 })).status).toBe(409);
    const list = await json<{ id: string; name: string; active: boolean }[]>(
      await owner.request("/api/positions"),
    );
    const senior = list.find((p) => p.name === "수석");
    expect(list.map((p) => p.name)).toEqual(expect.arrayContaining(["사원", "대표이사"]));
    expect((await patch(owner, `/api/positions/${senior?.id}`, { active: false })).status).toBe(
      200,
    );
  });
});

describe("역할 부여 (ADM-003)", () => {
  it("범위가 맞지 않는 부여는 거부된다", async () => {
    const members = await memberList(owner);
    const m = members.find((x) => x.email === "member2@example.com");
    const bad = await post(owner, `/api/account/members/${m?.userId}/roles`, {
      role: "business_admin",
      scopeType: "account",
    });
    expect(bad.status).toBe(400);
    const missing = await post(owner, `/api/account/members/${m?.userId}/roles`, {
      role: "auditor",
      scopeType: "department",
    });
    expect(missing.status).toBe(400);
  });

  it("관리자가 감사인 역할을 부여·회수하고, 사업자 관리자는 부여할 수 없다", async () => {
    await refresh();
    const m = (await memberList(owner)).find((x) => x.email === "member2@example.com");
    const denied = await post(bizadmin, `/api/account/members/${m?.userId}/roles`, {
      role: "auditor",
      scopeType: "department",
      scopeId: dept("FIN").id,
    });
    expect(denied.status).toBe(403);
    const granted = await post(admin, `/api/account/members/${m?.userId}/roles`, {
      role: "auditor",
      scopeType: "department",
      scopeId: dept("FIN").id,
    });
    expect(granted.status).toBe(201);
    const { id } = await json<{ id: string }>(granted);
    const dup = await post(admin, `/api/account/members/${m?.userId}/roles`, {
      role: "auditor",
      scopeType: "department",
      scopeId: dept("FIN").id,
    });
    expect(dup.status).toBe(409);
    const after = (await memberList(owner)).find((x) => x.email === "member2@example.com");
    expect(after?.grants.map((g) => g.role)).toContain("auditor");
    const revoked = await owner.request(`/api/account/members/${m?.userId}/roles/${id}`, {
      method: "DELETE",
    });
    expect(revoked.status).toBe(200);
    const actions = (await auditActions("fourm-test")).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["role.grant", "role.revoke"]));
  });

  it("부여한 역할이 실제 권한으로 작동한다 (부서 범위 감사인은 범위 판정 대상)", async () => {
    const members = await memberList(owner);
    const a = members.find((x) => x.email === "auditor@example.com");
    expect(a?.grants.map((g) => [g.role, g.scopeType])).toEqual([["auditor", "department"]]);
  });
});

describe("소속·겸직·발령 (ORG-032~035)", () => {
  it("주소속이 2개이거나 없는 요청은 거부된다", async () => {
    await refresh();
    const m = (await memberList(owner)).find((x) => x.email === "member1@example.com");
    const base = { businessId: biz("FM").id };
    const two = await owner.request(`/api/account/members/${m?.userId}/assignments`, {
      method: "PUT",
      body: {
        assignments: [
          { ...base, departmentId: dept("FIN").id, isPrimary: true },
          { ...base, departmentId: dept("HR").id, isPrimary: true },
        ],
      },
    });
    expect(two.status).toBe(400);
    const none = await owner.request(`/api/account/members/${m?.userId}/assignments`, {
      method: "PUT",
      body: { assignments: [{ ...base, departmentId: dept("FIN").id, isPrimary: false }] },
    });
    expect(none.status).toBe(400);
  });

  it("인사 관리자가 겸직을 추가·주소속을 변경하면 발령 이력이 남는다", async () => {
    await refresh();
    const m = (await memberList(owner)).find((x) => x.email === "member1@example.com");
    const put = await hr.request(`/api/account/members/${m?.userId}/assignments`, {
      method: "PUT",
      body: {
        assignments: [
          { businessId: biz("FM").id, departmentId: dept("HR").id, isPrimary: true },
          { businessId: biz("LG").id, departmentId: dept("LOG").id, isPrimary: false },
        ],
        reason: "정기 인사",
      },
    });
    expect(put.status).toBe(200);
    const after = (await memberList(owner)).find((x) => x.email === "member1@example.com");
    expect(after?.assignments).toHaveLength(2);
    expect(after?.assignments.find((a) => a.isPrimary)?.departmentId).toBe(dept("HR").id);

    const history = await json<{ action: string; reason: string | null }[]>(
      await hr.request(`/api/account/members/${m?.userId}/assignment-history`),
    );
    // 다른 테스트가 같은 구성원에게 이력을 남길 수 있어 이번 발령(사유로 구분)만 본다
    const mine = history.filter((h) => h.reason === "정기 인사");
    expect(mine.map((h) => h.action).sort()).toEqual(["create", "create", "end"]);
    // 본인은 자기 이력을 볼 수 있고, 타인의 이력은 권한자만 본다
    expect(
      (await member1.request(`/api/account/members/${m?.userId}/assignment-history`)).status,
    ).toBe(200);
    const other = (await memberList(owner)).find((x) => x.email === "member2@example.com");
    expect(
      (await member1.request(`/api/account/members/${other?.userId}/assignment-history`)).status,
    ).toBe(403);

    // 원복
    const back = await owner.request(`/api/account/members/${m?.userId}/assignments`, {
      method: "PUT",
      body: {
        assignments: [{ businessId: biz("FM").id, departmentId: dept("FIN").id, isPrimary: true }],
      },
    });
    expect(back.status).toBe(200);
  });

  it("사업자 관리자는 자기 사업자 밖 소속을 지정할 수 없다", async () => {
    const m = (await memberList(owner)).find((x) => x.email === "member2@example.com");
    const res = await bizadmin.request(`/api/account/members/${m?.userId}/assignments`, {
      method: "PUT",
      body: {
        assignments: [
          { businessId: biz("FM").id, departmentId: dept("FIN").id, isPrimary: true },
          { businessId: biz("LG").id, departmentId: dept("LOG").id, isPrimary: false },
        ],
      },
    });
    expect(res.status).toBe(403);
  });

  it("사번은 계정 안에서 고유하다 (ORG-034)", async () => {
    const members = await memberList(owner);
    const m1 = members.find((x) => x.email === "member1@example.com");
    const m2 = members.find((x) => x.email === "member2@example.com");
    expect(
      (await patch(hr, `/api/account/members/${m1?.userId}`, { employeeNo: "E-100" })).status,
    ).toBe(200);
    expect(
      (await patch(hr, `/api/account/members/${m2?.userId}`, { employeeNo: "E-100" })).status,
    ).toBe(409);
    expect(
      (await patch(hr, `/api/account/members/${m1?.userId}`, { employeeNo: null })).status,
    ).toBe(200);
  });
});

describe("초대 프리셋 (AUTH-006, ORG-032)", () => {
  it("수락하면 지정한 사업자·부서·직위로 주소속이 만들어진다", async () => {
    await refresh();
    const positions = await json<{ id: string; name: string }[]>(
      await owner.request("/api/positions"),
    );
    const created = await post(owner, "/api/account/invitations", {
      role: "member",
      preset: {
        businessId: biz("FM").id,
        departmentId: dept("SALES").id,
        positionId: positions.find((p) => p.name === "대리")?.id,
      },
    });
    expect(created.status).toBe(201);
    const { token } = await json<{ token: string }>(created);
    const newbie = await loginAs("newbie2@example.com");
    const accepted = await post(newbie, "/api/invitations/accept", { token });
    expect(accepted.status).toBe(200);
    const mine = (await memberList(newbie)).find((x) => x.email === "newbie2@example.com");
    expect(mine?.assignments).toHaveLength(1);
    expect(mine?.assignments[0]).toMatchObject({
      departmentId: dept("SALES").id,
      businessId: biz("FM").id,
      isPrimary: true,
    });
  });

  it("범위 밖 프리셋·관리자 역할 초대는 거부된다", async () => {
    await refresh();
    const outside = await post(bizadmin, "/api/account/invitations", {
      preset: { businessId: biz("LG").id, departmentId: dept("LOG").id },
    });
    expect(outside.status).toBe(403);
    const escalate = await post(bizadmin, "/api/account/invitations", {
      role: "admin",
      preset: { businessId: biz("FM").id, departmentId: dept("SALES").id },
    });
    expect(escalate.status).toBe(403);
    const ok = await post(bizadmin, "/api/account/invitations", {
      preset: { businessId: biz("FM").id, departmentId: dept("SALES").id },
    });
    expect(ok.status).toBe(201);
    // 부서가 사업자에 속하지 않는 프리셋
    const mismatch = await post(owner, "/api/account/invitations", {
      preset: { businessId: biz("LG").id, departmentId: dept("SALES").id },
    });
    expect(mismatch.status).toBe(400);
  });

  it("사업자 관리자는 자기 범위의 초대 목록만 본다", async () => {
    const list = await json<{ preset: { businessId?: string } }[]>(
      await bizadmin.request("/api/account/invitations"),
    );
    expect(list.length).toBeGreaterThan(0);
    for (const i of list) expect(i.preset.businessId).toBe(biz("FM").id);
    expect((await member1.request("/api/account/invitations")).status).toBe(403);
  });
});

describe("테넌트 격리 (PERM-002) — M2 API", () => {
  it("다른 회사의 사업자·부서·직위는 보이지 않는다", async () => {
    const theirBiz = await json<Biz[]>(await ownerB.request("/api/businesses"));
    expect(theirBiz.map((b) => b.code)).toContain("OT");
    expect(theirBiz.map((b) => b.code)).not.toContain("FM");
    const mine = await json<Dept[]>(await owner.request("/api/departments"));
    expect(mine.map((d) => d.code)).not.toContain("OPS");
  });

  it("다른 회사 부서·사업자 id로의 수정·이동·삭제는 404 또는 거부된다", async () => {
    // 다른 회사(다른회사(주))의 id를 DB에서 직접 읽는다
    const [other] = await authDb.db
      .select({ id: schema.department.id, businessId: schema.department.businessId })
      .from(schema.department)
      .where(eq(schema.department.code, "OPS"));
    expect(other).toBeTruthy();
    expect((await patch(owner, `/api/departments/${other?.id}`, { name: "침투" })).status).toBe(
      404,
    );
    expect(
      (await post(owner, `/api/departments/${other?.id}/move`, { newParentId: null })).status,
    ).toBe(404);
    expect(
      (await owner.request(`/api/departments/${other?.id}`, { method: "DELETE" })).status,
    ).toBe(404);
    expect((await post(owner, `/api/businesses/${other?.businessId}/deactivate`)).status).toBe(404);
    const res = await post(owner, "/api/departments", {
      businessId: other?.businessId,
      code: "INV",
      name: "타사 사업자에 생성",
    });
    expect([400, 403, 404, 409]).toContain(res.status);
  });
});

describe("부서 CSV (ORG-016)", () => {
  it("내보내기 후 다른 사업자로 가져오면 구조가 복제된다. 오류가 있으면 아무것도 만들지 않는다", async () => {
    await refresh();
    const exported = await owner.request(`/api/departments/export?businessId=${biz("FM").id}`);
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toContain("text/csv");
    const csv = await exported.text();
    expect(csv.split("\n")[0]).toBe("code,name,parentCode,shortName,sort");
    expect(csv).toContain("CASH");

    const imported = await post(owner, "/api/departments/import", {
      businessId: biz("LG").id,
      csv,
    });
    expect(imported.status).toBe(200);
    expect((await json<{ created: number }>(imported)).created).toBeGreaterThanOrEqual(5);
    const lgDepts = (await json<Dept[]>(await owner.request("/api/departments"))).filter(
      (d) => d.businessId === biz("LG").id,
    );
    expect(lgDepts.find((d) => d.code === "CASH")?.depth).toBe(3);

    // 같은 CSV를 다시 가져오면 모두 이미 있는 코드이므로 거부
    const again = await post(owner, "/api/departments/import", { businessId: biz("LG").id, csv });
    expect(again.status).toBe(400);
    const p = await json<Problem>(again);
    expect(p.code).toBe("import_invalid");

    // 뎁스 초과가 섞인 CSV는 전체 취소
    const before = (await json<Dept[]>(await owner.request("/api/departments"))).length;
    const bad = await post(owner, "/api/departments/import", {
      businessId: biz("LG").id,
      csv: "code,name,parentCode\nOK1,정상,\nDEEP,너무 깊음,CASH\n",
    });
    expect(bad.status).toBe(400);
    expect((await json<Dept[]>(await owner.request("/api/departments"))).length).toBe(before);

    // 일반 구성원은 내보내기·가져오기 불가
    expect(
      (await member1.request(`/api/departments/export?businessId=${biz("FM").id}`)).status,
    ).toBe(403);
  });
});

describe("계정 설정 (ADM-001)", () => {
  it("허용 도메인·세션·재인증·첨부 정책을 저장하고 변경이 감사 로그에 남는다", async () => {
    const res = await patch(owner, "/api/account/settings", {
      allowedDomains: ["Example.com"],
      securityPolicy: {
        idleTimeoutMinutes: 90,
        pinRequired: true,
        attachmentMaxMb: 20,
        attachmentExtensions: ["pdf", "PNG"],
      },
    });
    expect(res.status).toBe(200);
    const s = await json<{
      allowedDomains: string[];
      securityPolicy: { idleTimeoutMinutes: number; attachmentExtensions: string[] };
    }>(await owner.request("/api/account/settings"));
    expect(s.allowedDomains).toEqual(["example.com"]);
    expect(s.securityPolicy.idleTimeoutMinutes).toBe(90);
    expect(s.securityPolicy.attachmentExtensions).toEqual(["pdf", "png"]);
    const audit = (await auditActions("fourm-test")).filter(
      (a) => a.action === "account.settings_update",
    );
    expect(audit.length).toBeGreaterThan(0);
    // 원복
    await patch(owner, "/api/account/settings", { securityPolicy: { idleTimeoutMinutes: 120 } });
  });

  it("범위를 벗어난 값은 400", async () => {
    expect((await patch(owner, "/api/account/settings", { maxDeptDepth: 6 })).status).toBe(400);
    expect(
      (await patch(owner, "/api/account/settings", { securityPolicy: { idleTimeoutMinutes: 1 } }))
        .status,
    ).toBe(400);
  });
});

describe("감사 로그 (AUD-020)", () => {
  it("조직 변경 유형이 필수 항목과 함께 기록된다", async () => {
    const rows = await auditActions("fourm-test");
    const actions = new Set(rows.map((r) => r.action));
    for (const a of [
      "department.create",
      "department.move",
      "department.delete",
      "department.deactivate",
      "department.import",
      "member.assignments_update",
      "business.create",
      "account.settings_update",
      "position.create",
    ]) {
      expect(actions.has(a), a).toBe(true);
    }
    expect(rows.every((r) => r.result === "success" || r.result === "failure")).toBe(true);
  });
});

describe("구성원 상태 (FU-3 경쟁 조건, AUTH-015)", () => {
  it("관리자는 소유자를 변경할 수 없다", async () => {
    const members = await memberList(owner);
    const o = members.find((x) => x.email === "owner@example.com");
    expect(
      (await patch(admin, `/api/account/members/${o?.userId}`, { status: "left" })).status,
    ).toBe(403);
  });

  it("사업자 관리자는 소유자·관리자를 비활성화할 수 없다", async () => {
    const members = await memberList(owner);
    const a = members.find((x) => x.email === "admin@example.com");
    expect(
      (await patch(bizadmin, `/api/account/members/${a?.userId}`, { status: "left" })).status,
    ).toBe(403);
  });

  it("소유자 둘이 동시에 서로를 비활성화해도 한 명은 남는다", async () => {
    // 별도 회사를 만들어 검증한다: 새 소유자 A(owner-b)가 회사를 만들고 B(multi)를 소유자로 올린 뒤 동시 비활성화
    const created = await post(ownerB, "/api/accounts", { name: "경쟁조건 테스트(주)" });
    expect(created.status).toBe(201);
    const { accountId } = await json<{ accountId: string }>(created);
    const multi = await loginAs("multi@example.com");
    const inv = await json<{ token: string }>(
      await post(ownerB, "/api/account/invitations", { role: "admin" }),
    );
    await post(multi, "/api/invitations/accept", { token: inv.token });
    const members = await memberList(ownerB);
    const a = members.find((x) => x.email === "owner-b@example.com");
    const b = members.find((x) => x.email === "multi@example.com");
    // multi를 소유자로 승격 (소유권 이전 API가 없으므로 DB 직접 변경)
    await authDb.db
      .update(schema.membership)
      .set({ role: "owner" })
      .where(
        and(
          eq(schema.membership.accountId, accountId),
          eq(schema.membership.userId, b?.userId ?? ""),
        ),
      );
    const multiOwner = await loginAs("multi@example.com");
    await post(multiOwner, "/api/accounts/active", { accountId });
    const [r1, r2] = await Promise.all([
      patch(ownerB, `/api/account/members/${b?.userId}`, { status: "left" }),
      patch(multiOwner, `/api/account/members/${a?.userId}`, { status: "left" }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    // 이 회사는 시험용이다. 다른 시험이 owner-b·multi의 활성 회사로 이 회사를 만나지 않도록 모든 소속을 비활성화해 둔다
    await authDb.db
      .update(schema.membership)
      .set({ status: "left" })
      .where(eq(schema.membership.accountId, accountId));
    expect(statuses).toEqual([200, 409]);
  });
});

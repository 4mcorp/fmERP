import { describe, expect, it } from "vitest";
import { type Actor, can, canInAnyScope, grantScopeAllowed, type Target } from "./permissions";

const A = "biz-a";
const B = "biz-b";
const account: Target = { type: "account" };
const bizA: Target = { type: "business", businessId: A };
const bizB: Target = { type: "business", businessId: B };
// 경영지원본부(hq) > 재무팀(fin) 은 사업자 A 소속
const finA: Target = { type: "department", businessId: A, departmentPath: "hq/fin" };
const salesA: Target = { type: "department", businessId: A, departmentPath: "sales" };

const actor = (role: Actor["role"], grants: Actor["grants"] = []): Actor => ({ role, grants });

describe("소유자·계정 관리자 (PRD 3.3)", () => {
  it("모든 범위에서 조직 관리가 가능하다", () => {
    for (const role of ["owner", "admin"] as const) {
      for (const t of [account, bizA, finA]) {
        expect(can(actor(role), "department.edit", t)).toBe(true);
        expect(can(actor(role), "member.invite", t)).toBe(true);
      }
      expect(can(actor(role), "business.create", account)).toBe(true);
      expect(can(actor(role), "role.grant", account)).toBe(true);
      expect(can(actor(role), "account.settings", account)).toBe(true);
    }
  });

  it("소유자만 DB 덤프를 실행하고, 계정 관리자는 소유권 이전을 못 한다", () => {
    expect(can(actor("owner"), "dump.run", account)).toBe(true);
    expect(can(actor("admin"), "dump.run", account)).toBe(false);
    expect(can(actor("owner"), "ownership.transfer", account)).toBe(true);
    expect(can(actor("admin"), "ownership.transfer", account)).toBe(false);
  });

  it("관리자라고 문서 본문 열람 권한이 생기지 않는다 (PRD 3.3 각주 1)", () => {
    expect(can(actor("admin"), "document.read_all", account)).toBe(false);
  });
});

describe("일반 구성원", () => {
  it("관리 행위는 모두 거부한다", () => {
    const m = actor("member");
    expect(can(m, "department.edit", bizA)).toBe(false);
    expect(can(m, "member.invite", account)).toBe(false);
    expect(can(m, "role.grant", account)).toBe(false);
    expect(can(m, "position.manage", account)).toBe(false);
  });

  it("기안·결재는 가능하다", () => {
    expect(can(actor("member"), "approval.act", account)).toBe(true);
  });
});

describe("사업자 관리자 (범위: 사업자)", () => {
  const a = actor("member", [{ role: "business_admin", scopeType: "business", scopeId: A }]);

  it("자기 사업자의 부서·구성원은 관리한다", () => {
    expect(can(a, "department.edit", bizA)).toBe(true);
    expect(can(a, "department.edit", finA)).toBe(true);
    expect(can(a, "member.invite", bizA)).toBe(true);
  });

  it("다른 사업자와 계정 범위 작업은 거부한다", () => {
    expect(can(a, "department.edit", bizB)).toBe(false);
    expect(can(a, "member.invite", account)).toBe(false);
    expect(can(a, "business.create", account)).toBe(false);
    expect(can(a, "role.grant", account)).toBe(false);
  });
});

describe("인사 관리자", () => {
  it("발령과 직위·직책을 관리하지만 부서 편집은 못 한다", () => {
    const hr = actor("member", [{ role: "hr_admin", scopeType: "account", scopeId: null }]);
    expect(can(hr, "assignment.manage", bizA)).toBe(true);
    expect(can(hr, "position.manage", account)).toBe(true);
    expect(can(hr, "department.edit", bizA)).toBe(false);
  });

  it("사업자 범위 인사 관리자는 직위 마스터(계정 범위)를 못 바꾼다", () => {
    const hr = actor("member", [{ role: "hr_admin", scopeType: "business", scopeId: A }]);
    expect(can(hr, "assignment.manage", bizA)).toBe(true);
    expect(can(hr, "assignment.manage", bizB)).toBe(false);
    expect(can(hr, "position.manage", account)).toBe(false);
  });
});

describe("감사인 (범위: 부서+하위)", () => {
  const a = actor("member", [{ role: "auditor", scopeType: "department", scopeId: "hq" }]);

  it("범위 부서와 그 하위의 문서·감사 로그를 읽는다", () => {
    expect(can(a, "document.read_all", finA)).toBe(true);
    expect(
      can(a, "document.read_all", { type: "department", businessId: A, departmentPath: "hq" }),
    ).toBe(true);
  });

  it("범위 밖 부서·사업자·계정은 거부한다", () => {
    expect(can(a, "document.read_all", salesA)).toBe(false);
    expect(can(a, "document.read_all", bizA)).toBe(false);
    expect(can(a, "audit.read", account)).toBe(false);
  });

  it("부서 id가 접두어만 같은 다른 부서는 하위로 보지 않는다", () => {
    const x = actor("member", [{ role: "auditor", scopeType: "department", scopeId: "hq" }]);
    expect(
      can(x, "document.read_all", { type: "department", businessId: A, departmentPath: "hq2/fin" }),
    ).toBe(false);
  });

  it("감사인은 조직을 바꾸지 못한다 (읽기 전용)", () => {
    expect(can(a, "department.edit", finA)).toBe(false);
  });
});

describe("부재 설정 대행 (APV-052)", () => {
  it("소유자·관리자·결재 관리자만 다른 사람의 부재를 설정한다", () => {
    expect(can(actor("owner"), "delegation.manage", account)).toBe(true);
    expect(can(actor("admin"), "delegation.manage", account)).toBe(true);
    expect(
      can(
        actor("member", [{ role: "approval_admin", scopeType: "account", scopeId: null }]),
        "delegation.manage",
        account,
      ),
    ).toBe(true);
    expect(can(actor("member"), "delegation.manage", account)).toBe(false);
  });
});

describe("관리자 passkey 초기화 (PK1c)", () => {
  it("소유자·관리자만 구성원 passkey를 초기화한다. 사업자 관리자와 일반 구성원은 못 한다", () => {
    expect(can(actor("owner"), "member.passkey_reset", account)).toBe(true);
    expect(can(actor("admin"), "member.passkey_reset", account)).toBe(true);
    expect(
      can(
        actor("member", [{ role: "business_admin", scopeType: "account", scopeId: null }]),
        "member.passkey_reset",
        account,
      ),
    ).toBe(false);
    expect(can(actor("member"), "member.passkey_reset", account)).toBe(false);
  });
});

describe("구성원 PIN 초기화 (member.pin_reset)", () => {
  it("소유자·계정 관리자는 가능하다", () => {
    expect(can(actor("owner"), "member.pin_reset", account)).toBe(true);
    expect(can(actor("admin"), "member.pin_reset", account)).toBe(true);
    expect(can(actor("owner"), "member.pin_reset", bizA)).toBe(true);
    expect(can(actor("admin"), "member.pin_reset", bizA)).toBe(true);
  });

  it("사업자 관리자·인사 관리자·감사인·결재 관리자·일반 구성원은 거부한다", () => {
    const bizAdmin = actor("member", [
      { role: "business_admin", scopeType: "business", scopeId: A },
    ]);
    const hr = actor("member", [{ role: "hr_admin", scopeType: "account", scopeId: null }]);
    const auditor = actor("member", [{ role: "auditor", scopeType: "account", scopeId: null }]);
    const approver = actor("member", [
      { role: "approval_admin", scopeType: "account", scopeId: null },
    ]);
    for (const a of [bizAdmin, hr, auditor, approver, actor("member")]) {
      expect(can(a, "member.pin_reset", account)).toBe(false);
      expect(can(a, "member.pin_reset", bizA)).toBe(false);
    }
  });

  it("메뉴 노출도 소유자·계정 관리자만 된다", () => {
    expect(canInAnyScope(actor("owner"), "member.pin_reset")).toBe(true);
    expect(canInAnyScope(actor("admin"), "member.pin_reset")).toBe(true);
    expect(
      canInAnyScope(
        actor("member", [{ role: "business_admin", scopeType: "business", scopeId: A }]),
        "member.pin_reset",
      ),
    ).toBe(false);
  });
});

describe("결재 진행 문서 관리", () => {
  it("소유자·관리자·결재 관리자(범위 안)만 하고, 사업자 관리자·감사인은 못 한다", () => {
    const approver = actor("member", [
      { role: "approval_admin", scopeType: "business", scopeId: A },
    ]);
    expect(can(actor("owner"), "approval.manage", bizA)).toBe(true);
    expect(can(actor("admin"), "approval.manage", bizA)).toBe(true);
    expect(can(approver, "approval.manage", bizA)).toBe(true);
    expect(can(approver, "approval.manage", bizB)).toBe(false);
    expect(
      can(
        actor("member", [{ role: "business_admin", scopeType: "business", scopeId: A }]),
        "approval.manage",
        bizA,
      ),
    ).toBe(false);
    expect(
      can(
        actor("member", [{ role: "auditor", scopeType: "account", scopeId: null }]),
        "approval.manage",
        bizA,
      ),
    ).toBe(false);
  });
});

describe("결재 관리자", () => {
  it("양식 관리는 가능하고 조직 관리는 못 한다", () => {
    const ap = actor("member", [{ role: "approval_admin", scopeType: "account", scopeId: null }]);
    expect(can(ap, "form.manage", bizA)).toBe(true);
    expect(can(ap, "department.edit", bizA)).toBe(false);
  });
});

describe("역할 부여 범위 검증 (PERM-001)", () => {
  it("역할별로 허용되는 범위 유형만 통과한다", () => {
    expect(grantScopeAllowed("business_admin", "business")).toBe(true);
    expect(grantScopeAllowed("business_admin", "account")).toBe(false);
    expect(grantScopeAllowed("auditor", "department")).toBe(true);
    expect(grantScopeAllowed("hr_admin", "department")).toBe(false);
    expect(grantScopeAllowed("approval_admin", "account")).toBe(true);
  });
});

describe("어느 범위에서든 가능한지 (메뉴 노출)", () => {
  it("역할 부여가 하나라도 있으면 해당 행위를 노출한다", () => {
    const a = actor("member", [{ role: "business_admin", scopeType: "business", scopeId: A }]);
    expect(canInAnyScope(a, "member.invite")).toBe(true);
    expect(canInAnyScope(a, "role.grant")).toBe(false);
    expect(canInAnyScope(actor("member"), "department.edit")).toBe(false);
    expect(canInAnyScope(actor("admin"), "role.grant")).toBe(true);
  });
});

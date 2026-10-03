/** 역할(RBAC) 권한 판정 (PRD 3.2·3.3, PERM-001). 순수 함수 — 서버가 요청마다 이 함수로 판정한다. */

export type MemberRole = "owner" | "admin" | "member";

/** role_grant로 부여하는 역할. 소유자·계정 관리자는 membership.role로 가지며 계정 범위가 암묵적이다. */
export const GRANT_ROLES = ["business_admin", "approval_admin", "auditor", "hr_admin"] as const;
export type GrantRole = (typeof GRANT_ROLES)[number];

export const SCOPE_TYPES = ["account", "business", "department"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

const ALLOWED_SCOPES: Record<GrantRole, readonly ScopeType[]> = {
  business_admin: ["business"],
  approval_admin: ["account", "business"],
  auditor: ["account", "business", "department"],
  hr_admin: ["account", "business"],
};

export function grantScopeAllowed(role: GrantRole, scope: ScopeType): boolean {
  return ALLOWED_SCOPES[role].includes(scope);
}

export interface Grant {
  role: GrantRole;
  scopeType: ScopeType;
  /** 계정 범위면 null, 사업자·부서 범위면 해당 id */
  scopeId: string | null;
}

export interface Actor {
  role: MemberRole;
  grants: Grant[];
}

/** 행위의 대상이 놓인 위치. 부서는 구체화 경로(`조상/…/자기`)로 하위 포함 여부를 판단한다. */
export type Target =
  | { type: "account" }
  | { type: "business"; businessId: string }
  | { type: "department"; businessId: string; departmentPath: string };

export type Action =
  | "account.settings"
  | "business.create"
  | "role.grant"
  | "ownership.transfer"
  | "dump.run"
  | "department.edit"
  | "member.invite"
  | "member.deactivate"
  | "assignment.manage"
  | "position.manage"
  | "form.manage"
  | "audit.read"
  | "document.read_all"
  | "org.read"
  | "approval.act";

interface Rule {
  owner?: boolean;
  admin?: boolean;
  everyone?: boolean;
  grants?: readonly GrantRole[];
}

const RULES: Record<Action, Rule> = {
  "account.settings": { owner: true, admin: true },
  "business.create": { owner: true, admin: true },
  "role.grant": { owner: true, admin: true },
  "ownership.transfer": { owner: true },
  "dump.run": { owner: true },
  "department.edit": { owner: true, admin: true, grants: ["business_admin"] },
  "member.invite": { owner: true, admin: true, grants: ["business_admin"] },
  "member.deactivate": { owner: true, admin: true, grants: ["business_admin"] },
  "assignment.manage": { owner: true, admin: true, grants: ["business_admin", "hr_admin"] },
  "position.manage": { owner: true, admin: true, grants: ["hr_admin"] },
  "form.manage": { owner: true, admin: true, grants: ["business_admin", "approval_admin"] },
  "audit.read": { owner: true, admin: true, grants: ["auditor"] },
  // 관리자라고 문서 본문을 볼 수 있는 것은 아니다 (PRD 3.3 각주 1)
  "document.read_all": { owner: true, grants: ["auditor"] },
  "org.read": { everyone: true },
  "approval.act": { everyone: true },
};

function grantCovers(grant: Grant, target: Target): boolean {
  switch (grant.scopeType) {
    case "account":
      return true;
    case "business":
      return target.type !== "account" && target.businessId === grant.scopeId;
    case "department":
      return (
        target.type === "department" &&
        grant.scopeId !== null &&
        target.departmentPath.split("/").includes(grant.scopeId)
      );
  }
}

export function can(actor: Actor, action: Action, target: Target): boolean {
  const rule = RULES[action];
  if (rule.everyone) return true;
  if (actor.role === "owner" && rule.owner) return true;
  if (actor.role === "admin" && rule.admin) return true;
  return actor.grants.some(
    (g) =>
      rule.grants?.includes(g.role) &&
      grantScopeAllowed(g.role, g.scopeType) &&
      grantCovers(g, target),
  );
}

/** 범위와 상관없이 이 행위를 어딘가에서 할 수 있는지 (메뉴 노출·목록 접근용). 실제 실행은 대상 범위로 `can()`을 다시 확인한다. */
export function canInAnyScope(actor: Actor, action: Action): boolean {
  const rule = RULES[action];
  if (rule.everyone) return true;
  if (actor.role === "owner" && rule.owner) return true;
  if (actor.role === "admin" && rule.admin) return true;
  return actor.grants.some((g) => rule.grants?.includes(g.role));
}

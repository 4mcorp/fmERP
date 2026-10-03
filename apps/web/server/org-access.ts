// 조직·권한 API가 공통으로 쓰는 권한 판정 헬퍼. 판정 규칙 자체는 packages/core의 can()에 있다 (PRD 3.2·3.3).
import {
  type Action,
  type Actor,
  can,
  type Grant,
  type GrantRole,
  type ScopeType,
  type Target,
} from "@fmerp/core";
import { schema, type Tx } from "@fmerp/db";
import { and, eq, isNull } from "drizzle-orm";
import { ApiError } from "./http";

export interface TenantInfo {
  accountId: string;
  role: "owner" | "admin" | "member";
}

/** 요청자의 구성원 정보와 역할 부여 목록을 읽어 권한 판정용 Actor로 만든다 */
export async function loadActor(
  tx: Tx,
  tenant: TenantInfo,
  userId: string,
): Promise<{ actor: Actor; membershipId: string }> {
  const [m] = await tx
    .select({ id: schema.membership.id })
    .from(schema.membership)
    .where(eq(schema.membership.userId, userId));
  if (!m) throw new ApiError(403, "forbidden", "권한이 없습니다");
  const grants = await tx
    .select({
      role: schema.roleGrant.role,
      scopeType: schema.roleGrant.scopeType,
      scopeId: schema.roleGrant.scopeId,
    })
    .from(schema.roleGrant)
    .where(eq(schema.roleGrant.membershipId, m.id));
  return {
    membershipId: m.id,
    actor: {
      role: tenant.role,
      grants: grants.map(
        (g): Grant => ({
          role: g.role as GrantRole,
          scopeType: g.scopeType as ScopeType,
          scopeId: g.scopeId,
        }),
      ),
    },
  };
}

export function authorize(actor: Actor, action: Action, target: Target): void {
  if (!can(actor, action, target)) throw new ApiError(403, "forbidden", "권한이 없습니다");
}

export const ACCOUNT_TARGET: Target = { type: "account" };
export const businessTarget = (businessId: string): Target => ({ type: "business", businessId });

export async function departmentTarget(tx: Tx, departmentId: string): Promise<Target> {
  const [d] = await tx
    .select({ businessId: schema.department.businessId, path: schema.department.path })
    .from(schema.department)
    .where(eq(schema.department.id, departmentId));
  if (!d) throw new ApiError(404, "not_found", "부서를 찾을 수 없습니다");
  return { type: "department", businessId: d.businessId, departmentPath: d.path };
}

/** 구성원이 소속된 사업자들(유효 소속 기준). 구성원 대상 행위는 이 중 하나라도 권한 범위에 있으면 허용한다 */
export async function memberBusinessTargets(tx: Tx, membershipId: string): Promise<Target[]> {
  const rows = await tx
    .selectDistinct({ businessId: schema.assignment.businessId })
    .from(schema.assignment)
    .where(
      and(eq(schema.assignment.membershipId, membershipId), isNull(schema.assignment.validTo)),
    );
  return rows.map((r) => businessTarget(r.businessId));
}

/** 구성원 대상 행위의 권한: 계정 범위 권한이거나, 구성원의 소속 사업자 중 하나에 대한 권한 */
export async function authorizeForMember(
  tx: Tx,
  actor: Actor,
  action: Action,
  membershipId: string,
): Promise<void> {
  if (can(actor, action, ACCOUNT_TARGET)) return;
  const targets = await memberBusinessTargets(tx, membershipId);
  if (targets.some((t) => can(actor, action, t))) return;
  throw new ApiError(403, "forbidden", "권한이 없습니다");
}

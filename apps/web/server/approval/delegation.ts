import { recordAudit } from "@fmerp/audit";
import { validateDelegation } from "@fmerp/core";
import { schema } from "@fmerp/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { ApprovalError } from "./errors";
import { loadDelegationRules, type ServiceContext } from "./service";

export interface CreateDelegationInput {
  membershipId: string;
  delegateMembershipId: string;
  from: Date;
  to: Date;
  scope: { kind: "all" } | { kind: "category"; categories: string[] };
  reason?: string;
}

/** 부재·대결 설정 (APV-050·052·053). 본인 설정과 관리자 대행은 호출 쪽 라우트가 권한을 확인한다 */
export async function createDelegation(ctx: ServiceContext, input: CreateDelegationInput) {
  const existing = await loadDelegationRules(ctx.tx);
  const check = validateDelegation(
    {
      membershipId: input.membershipId,
      delegateId: input.delegateMembershipId,
      from: input.from,
      to: input.to,
      scope: input.scope,
    },
    existing,
  );
  if (!check.ok) throw new ApprovalError("delegation_invalid", check.reason);

  // 대결자는 재직 중인 같은 계정 구성원이어야 한다
  const [delegate] = await ctx.tx
    .select({ status: schema.membership.status })
    .from(schema.membership)
    .where(eq(schema.membership.id, input.delegateMembershipId));
  if (delegate?.status !== "active") {
    throw new ApprovalError("delegation_invalid", "대결자는 재직 중인 구성원이어야 합니다");
  }

  const [row] = await ctx.tx
    .insert(schema.delegation)
    .values({
      accountId: ctx.accountId,
      membershipId: input.membershipId,
      delegateMembershipId: input.delegateMembershipId,
      validFrom: input.from,
      validTo: input.to,
      scope: input.scope,
      reason: input.reason,
      createdBy: ctx.userId,
    })
    .returning({ id: schema.delegation.id });
  if (!row) throw new Error("부재 설정 실패");
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "delegation.create",
    target: { type: "delegation", id: row.id },
    reason: input.reason,
    result: "success",
    request: ctx.request,
  });
  return { id: row.id };
}

export async function revokeDelegation(ctx: ServiceContext, id: string) {
  const rows = await ctx.tx
    .update(schema.delegation)
    .set({ revokedAt: ctx.now })
    .where(and(eq(schema.delegation.id, id), isNull(schema.delegation.revokedAt)))
    .returning({ id: schema.delegation.id });
  if (rows.length === 0) throw new ApprovalError("not_found", "부재 설정을 찾을 수 없습니다");
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "delegation.revoke",
    target: { type: "delegation", id },
    result: "success",
    request: ctx.request,
  });
}

export function listDelegations(ctx: ServiceContext) {
  return ctx.tx
    .select()
    .from(schema.delegation)
    .where(isNull(schema.delegation.revokedAt))
    .orderBy(desc(schema.delegation.validFrom));
}

import { recordAudit } from "@fmerp/audit";
import { schema } from "@fmerp/db";
import { ServiceError } from "@fmerp/shared/server/errors";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { validateDelegation } from "../domain/delegation";
import { engineContext, loadDelegationRules, type ServiceContext } from "./service";
import { lockAndLoad } from "./store";

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
  if (!check.ok) throw new ServiceError("delegation_invalid", check.reason);

  // 대결자는 재직 중인 같은 계정 구성원이어야 한다
  const [delegate] = await ctx.tx
    .select({ status: schema.membership.status })
    .from(schema.membership)
    .where(eq(schema.membership.id, input.delegateMembershipId));
  if (delegate?.status !== "active") {
    throw new ServiceError("delegation_invalid", "대결자는 재직 중인 구성원이어야 합니다");
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
  await refreshActiveDelegates(ctx, input.membershipId);
  return { id: row.id };
}

/**
 * 부재 설정이 바뀌면, 이미 차례가 와서 대기 중인 단계의 대결자도 다시 정한다 (갑작스러운 부재 대응, APV-052).
 * 문서 행을 잠근 뒤 단계의 대결자와 version만 바꾼다.
 */
async function refreshActiveDelegates(ctx: ServiceContext, membershipId: string) {
  const affected = await ctx.tx
    .selectDistinct({ documentId: schema.approvalStep.documentId })
    .from(schema.approvalStep)
    .where(
      and(
        eq(schema.approvalStep.status, "ACTIVE"),
        sql`${membershipId} = any(${schema.approvalStep.assigneeIds})`,
      ),
    );
  for (const { documentId } of affected.sort((a, b) => a.documentId.localeCompare(b.documentId))) {
    const loaded = await lockAndLoad(ctx.tx, documentId);
    const engine = await engineContext(ctx, loaded.row.formCategory);
    for (const step of loaded.doc.steps) {
      if (step.status !== "ACTIVE" || !step.assigneeIds.includes(membershipId)) continue;
      const delegates: Record<string, string> = {};
      for (const assignee of step.assigneeIds) {
        const decision = engine.decideDelegate(assignee);
        if (decision.kind === "delegate") delegates[assignee] = decision.delegateId;
      }
      if (JSON.stringify(delegates) === JSON.stringify(step.delegates)) continue;
      await ctx.tx
        .update(schema.approvalStep)
        .set({ delegates, version: step.version + 1 })
        .where(
          and(eq(schema.approvalStep.id, step.id), eq(schema.approvalStep.version, step.version)),
        );
    }
  }
}

export async function revokeDelegation(ctx: ServiceContext, id: string) {
  const rows = await ctx.tx
    .update(schema.delegation)
    .set({ revokedAt: ctx.now })
    .where(and(eq(schema.delegation.id, id), isNull(schema.delegation.revokedAt)))
    .returning({ id: schema.delegation.id, membershipId: schema.delegation.membershipId });
  const revoked = rows[0];
  if (!revoked) throw new ServiceError("not_found", "부재 설정을 찾을 수 없습니다");
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "delegation.revoke",
    target: { type: "delegation", id },
    result: "success",
    request: ctx.request,
  });
  await refreshActiveDelegates(ctx, revoked.membershipId);
}

export function listDelegations(ctx: ServiceContext) {
  return ctx.tx
    .select()
    .from(schema.delegation)
    .where(isNull(schema.delegation.revokedAt))
    .orderBy(desc(schema.delegation.validFrom));
}

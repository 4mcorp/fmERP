// 결재자 일괄 이관과 장기 미처리 목록 (PRD ADM-005, ORG-036)

import { computeAuditDiff, recordAudit } from "@fmerp/audit";
import { type Actor, can, planTransfer } from "@fmerp/core";
import { schema } from "@fmerp/db";
import { eq, sql } from "drizzle-orm";
import { businessTarget } from "../org-access";
import type { ServiceContext } from "./context";
import { ApprovalError } from "./errors";
import { loadMemberCards } from "./org-snapshot";
import { lockAndLoad } from "./store";

/** 구성원이 처리자로 처리 전 단계에 걸려 있는 진행 중 문서 id (잠금 순서를 고정하려고 id 순) */
async function openDocumentsOf(ctx: ServiceContext, membershipId: string): Promise<string[]> {
  const { rows } = await ctx.tx.execute<{ id: string }>(
    sql`select distinct d.id
        from ${schema.document} d
        join ${schema.approvalStep} s on s.document_id = d.id
        where d.status in ('IN_PROGRESS', 'ON_HOLD') and s.status in ('PENDING', 'ACTIVE', 'HELD')
          and ${membershipId}::uuid = any (s.assignee_ids)
        order by d.id`,
  );
  return rows.map((r) => r.id);
}

/**
 * 결재자 일괄 이관: from이 처리자인 처리 전 단계를 모두 to로 바꾼다. 한 문서라도 권한이 없거나 실패하면 전부 취소된다
 * (호출자의 withTenant 트랜잭션). 사유는 필수이고 문서마다 감사 로그에 남긴다.
 */
export async function transferAssignments(
  ctx: ServiceContext,
  input: { actor: Actor; fromMembershipId: string; toMembershipId: string; reason: string },
) {
  const { tx } = ctx;
  // 이관할 문서가 없어도 잘못된 요청은 거부한다
  if (input.reason.trim() === "") {
    throw new ApprovalError("reason_required", "이관 사유를 입력하세요");
  }
  if (input.fromMembershipId === input.toMembershipId) {
    throw new ApprovalError("invalid_transfer", "같은 사람에게는 이관할 수 없습니다");
  }
  const [from] = await tx
    .select({ id: schema.membership.id })
    .from(schema.membership)
    .where(eq(schema.membership.id, input.fromMembershipId));
  if (!from) throw new ApprovalError("validation_failed", "이관할 구성원을 찾을 수 없습니다");
  const [to] = await tx
    .select({ id: schema.membership.id, status: schema.membership.status })
    .from(schema.membership)
    .where(eq(schema.membership.id, input.toMembershipId));
  if (to?.status !== "active") {
    throw new ApprovalError("validation_failed", "대체 결재자는 재직 중인 구성원이어야 합니다");
  }

  const documentIds = await openDocumentsOf(ctx, input.fromMembershipId);
  let steps = 0;
  for (const id of documentIds) {
    const loaded = await lockAndLoad(tx, id);
    // 이관은 결재 관리 권한이다. 관리 범위 밖 사업자의 문서가 하나라도 있으면 전체를 거부한다
    if (!can(input.actor, "approval.manage", businessTarget(loaded.row.businessId))) {
      throw new ApprovalError("forbidden", "이관 대상 문서를 관리할 권한이 없습니다");
    }
    const plan = planTransfer(loaded.doc, {
      from: input.fromMembershipId,
      to: input.toMembershipId,
      reason: input.reason,
    });
    if (!plan.ok) throw new ApprovalError(plan.code, plan.message);
    if (plan.changes.length === 0) continue;

    const cards = await loadMemberCards(
      tx,
      plan.changes.flatMap((c) => c.assigneeIds),
    );
    for (const change of plan.changes) {
      const snapshot = change.assigneeIds.map((a) => cards.get(a) ?? { membershipId: a });
      await tx.execute(
        sql`select transfer_step_assignees(
          ${change.stepId}::uuid,
          array[${sql.join(
            change.assigneeIds.map((a) => sql`${a}::uuid`),
            sql`, `,
          )}],
          ${JSON.stringify(snapshot)}::jsonb)`,
      );
      steps += 1;
    }
    await recordAudit(tx, {
      accountId: ctx.accountId,
      actorUserId: ctx.userId,
      action: "approval.transfer",
      target: { type: "document", id: loaded.row.id, label: loaded.row.title },
      reason: input.reason.trim(),
      diff: computeAuditDiff(
        { assignee: input.fromMembershipId },
        { assignee: input.toMembershipId },
      ),
      result: "success",
      request: ctx.request,
    });
  }
  return { documents: documentIds.length, steps };
}

export interface OverdueItem {
  id: string;
  title: string;
  docNo: string | null;
  businessId: string;
  status: string;
  drafterName: string;
  /** 지금 처리 차례인 사람들 (결재 시점 스냅샷) */
  waiting: unknown[];
  /** 마지막 처리 이후 경과 일수 */
  waitingDays: number;
}

/** 장기 미처리 진행 중 문서: 마지막 변경 이후 N일이 지난 문서. 결재 관리 범위의 사업자만 본다 (ADM-005) */
export async function listOverdue(
  ctx: ServiceContext,
  actor: Actor,
  days: number,
): Promise<OverdueItem[]> {
  // 결재 관리 범위가 하나도 없으면 빈 목록이 아니라 접근 거부로 구분한다
  const businesses = await ctx.tx.select({ id: schema.business.id }).from(schema.business);
  if (!businesses.some((b) => can(actor, "approval.manage", businessTarget(b.id)))) {
    throw new ApprovalError("forbidden", "결재 관리 권한이 없습니다");
  }
  const { rows } = await ctx.tx.execute<{
    id: string;
    title: string;
    doc_no: string | null;
    business_id: string;
    status: string;
    drafter_name: string;
    waiting: unknown[] | null;
    waiting_days: string;
  }>(
    sql`select d.id, d.title, d.doc_no, d.business_id, d.status, u.name as drafter_name,
          (select jsonb_agg(sn.value) from approval_step s, jsonb_array_elements(s.assignee_snapshot) sn
            where s.document_id = d.id and s.status in ('ACTIVE', 'HELD')) as waiting,
          floor(extract(epoch from (${ctx.now.toISOString()}::timestamptz - d.updated_at)) / 86400) as waiting_days
        from ${schema.document} d
        join ${schema.membership} m on m.id = d.drafter_membership_id
        join "user" u on u.id = m.user_id
        where d.status in ('IN_PROGRESS', 'ON_HOLD')
          and d.updated_at < ${ctx.now.toISOString()}::timestamptz - make_interval(days => ${days})
        order by d.updated_at
        limit 200`,
  );
  return rows
    .filter((r) => can(actor, "approval.manage", businessTarget(r.business_id)))
    .map((r) => ({
      id: r.id,
      title: r.title,
      docNo: r.doc_no,
      businessId: r.business_id,
      status: r.status,
      drafterName: r.drafter_name,
      waiting: r.waiting ?? [],
      waitingDays: Number(r.waiting_days),
    }));
}

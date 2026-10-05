// 문서 이력 타임라인(AUD-011)과 인쇄 기록(AUD-020). 병합·중복 제거 규칙은 packages/core의 buildTimeline이 가진다.
import { recordAudit } from "@fmerp/audit";
import { buildTimeline, canInAnyScope } from "@fmerp/core";
import { schema } from "@fmerp/db";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireView, type Viewer } from "../approval/access";
import type { ServiceContext } from "../approval/context";

const MAX_LOGS = 500;
/** 같은 사용자·문서의 인쇄 기록은 이 시간 안에는 한 번만 남긴다. 추가 전용 로그를 반복 호출로 부풀리지 못하게 한다 */
const PRINT_LOG_GAP_SECONDS = 5;

/** 문서 이력 타임라인. 열람 권한은 문서 열람과 같다 (감사인·소유자의 열람이면 열람 기록이 남는다) */
export async function documentTimeline(ctx: ServiceContext, documentId: string, viewer: Viewer) {
  await requireView(ctx, documentId, viewer);
  const { tx } = ctx;

  const actorMembership = alias(schema.membership, "actor_membership");
  const actorUser = alias(schema.user, "actor_user");
  const proxyMembership = alias(schema.membership, "proxy_membership");
  const proxyUser = alias(schema.user, "proxy_user");
  const actions = await tx
    .select({
      at: schema.approvalAction.createdAt,
      kind: schema.approvalAction.action,
      actor: actorUser.name,
      onBehalfOf: proxyUser.name,
      comment: schema.approvalAction.comment,
    })
    .from(schema.approvalAction)
    .innerJoin(actorMembership, eq(actorMembership.id, schema.approvalAction.actorMembershipId))
    .innerJoin(actorUser, eq(actorUser.id, actorMembership.userId))
    .leftJoin(proxyMembership, eq(proxyMembership.id, schema.approvalAction.onBehalfOfMembershipId))
    .leftJoin(proxyUser, eq(proxyUser.id, proxyMembership.userId))
    .where(eq(schema.approvalAction.documentId, documentId))
    .orderBy(asc(schema.approvalAction.createdAt));

  const events = await tx
    .select({ at: schema.approvalEvent.createdAt, type: schema.approvalEvent.type })
    .from(schema.approvalEvent)
    .where(
      and(
        eq(schema.approvalEvent.documentId, documentId),
        eq(schema.approvalEvent.type, "completed"),
      ),
    );

  const logs = await tx
    .select({
      at: schema.auditLog.occurredAt,
      action: schema.auditLog.action,
      actor: schema.user.name,
      reason: schema.auditLog.reason,
      ip: schema.auditLog.ip,
    })
    .from(schema.auditLog)
    .leftJoin(schema.user, eq(schema.user.id, schema.auditLog.actorUserId))
    .where(
      and(eq(schema.auditLog.targetType, "document"), eq(schema.auditLog.targetId, documentId)),
    )
    .orderBy(asc(schema.auditLog.occurredAt), asc(schema.auditLog.id))
    .limit(MAX_LOGS);

  // 열람 기록과 접속지는 감사 권한이 있는 사람(소유자·관리자·감사인)에게만 보인다
  const privileged =
    canInAnyScope(viewer.actor, "audit.read") || canInAnyScope(viewer.actor, "document.read_all");
  return buildTimeline({
    actions,
    events,
    logs,
    includeViews: privileged,
    includeIp: privileged,
  });
}

/** 인쇄 기록. 브라우저 인쇄는 서버가 알 수 없어 화면의 인쇄 버튼이 이 호출을 한 뒤 인쇄한다 (AUD-020) */
export async function recordPrint(ctx: ServiceContext, documentId: string, viewer: Viewer) {
  await requireView(ctx, documentId, viewer);
  if (!ctx.userId) return;
  // 동시 요청도 한 번만 통과하도록 직렬화한 뒤 최근 기록을 확인한다
  await ctx.tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`print:${ctx.userId}:${documentId}`}, 0))`,
  );
  const A = schema.auditLog;
  const [recent] = await ctx.tx
    .select({ id: A.id })
    .from(A)
    .where(
      and(
        eq(A.action, "document.print"),
        eq(A.actorUserId, ctx.userId),
        eq(A.targetId, documentId),
        gt(A.occurredAt, sql`now() - ${`${PRINT_LOG_GAP_SECONDS} seconds`}::interval`),
      ),
    )
    .limit(1);
  if (recent) return;
  const [doc] = await ctx.tx
    .select({ title: schema.document.title })
    .from(schema.document)
    .where(eq(schema.document.id, documentId));
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "document.print",
    target: { type: "document", id: documentId, label: doc?.title },
    result: "success",
    request: ctx.request,
  });
}

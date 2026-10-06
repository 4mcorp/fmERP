// 감사 로그 조회(AUD-025)와 월간 접속 기록 점검(AUD-026). 전체 로그는 계정 범위 `audit.read` 보유자만 본다.
import { recordAudit } from "@fmerp/audit";
import { schema } from "@fmerp/db";
import { ACCOUNT_TARGET, authorize } from "@fmerp/shared/authz/org-access";
import { type Actor, can } from "@fmerp/shared/domain/permissions";
import type { ServiceContext } from "@fmerp/shared/server/context";
import { decodeCursor, encodeCursor } from "@fmerp/shared/server/cursor";
import { ServiceError } from "@fmerp/shared/server/errors";
import { and, desc, eq, gte, lt, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { reviewStatuses, reviewTargetPeriod } from "../domain/audit-review";

const A = schema.auditLog;
const MAX_LIMIT = 100;
const DEFAULT_DAYS = 30;
const REVIEW_MONTHS = 12;

export interface AuditLogFilters {
  from?: Date;
  /** 이 시각 직전까지 (미포함) */
  to?: Date;
  actorUserId?: string;
  /** 행위 유형. `approval.`처럼 점으로 끝나면 그 접두사로 시작하는 모든 행위 */
  action?: string;
  targetType?: string;
  targetId?: string;
  result?: "success" | "failure";
}

export interface AuditLogRow {
  id: string;
  occurredAt: Date;
  actorUserId: string | null;
  actorName: string | null;
  onBehalfOfName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  subjectName: string | null;
  diff: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  result: string;
  reason: string | null;
  /** 문서 내용(제목·결재 의견·첨부 이름)을 열람할 권한이 없어 targetLabel·reason을 가렸는지 */
  masked: boolean;
}

/** 문서·첨부를 대상으로 한 로그의 targetLabel(제목·파일명)과 reason(결재 의견 등)은 문서 내용이다 */
const CONTENT_TARGETS = new Set(["document", "attachment"]);

const escapeLike = (s: string) => s.replace(/[%_]/g, (c) => `\${c}`);

/** 감사 로그 조회. 첫 쪽을 읽으면 조회 행위 자체도 기록한다 (로그에 개인정보가 있기 때문, AUD-020) */
export async function queryAuditLogs(
  ctx: ServiceContext,
  actor: Actor,
  filters: AuditLogFilters,
  opts: { limit?: number; cursor?: string } = {},
): Promise<{ items: AuditLogRow[]; nextCursor: string | null }> {
  authorize(actor, "audit.read", ACCOUNT_TARGET);
  // 관리자는 감사 로그를 보지만 문서 본문은 볼 수 없다(PRD 3.3 각주). 로그의 제목·의견으로 우회하지 못하게 가린다
  const canSeeContent = can(actor, "document.read_all", ACCOUNT_TARGET);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), MAX_LIMIT);
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  const from = filters.from ?? new Date(ctx.now.getTime() - DEFAULT_DAYS * 86_400_000);

  const where: (SQL | undefined)[] = [
    gte(A.occurredAt, from),
    filters.to ? lt(A.occurredAt, filters.to) : undefined,
    filters.actorUserId ? eq(A.actorUserId, filters.actorUserId) : undefined,
    filters.action
      ? filters.action.endsWith(".")
        ? sql`${A.action} like ${`${escapeLike(filters.action)}%`}`
        : eq(A.action, filters.action)
      : undefined,
    filters.targetType ? eq(A.targetType, filters.targetType) : undefined,
    filters.targetId ? eq(A.targetId, filters.targetId) : undefined,
    filters.result ? eq(A.result, filters.result) : undefined,
    cursor
      ? or(
          sql`${A.occurredAt} < ${cursor.at}::timestamptz`,
          and(sql`${A.occurredAt} = ${cursor.at}::timestamptz`, sql`${A.id} < ${cursor.id}::uuid`),
        )
      : undefined,
  ];

  const actorUser = alias(schema.user, "actor_user");
  const proxyUser = alias(schema.user, "proxy_user");
  const subjectUser = alias(schema.user, "subject_user");
  const rows = await ctx.tx
    .select({
      id: A.id,
      occurredAt: A.occurredAt,
      actorUserId: A.actorUserId,
      actorName: actorUser.name,
      onBehalfOfName: proxyUser.name,
      action: A.action,
      targetType: A.targetType,
      targetId: A.targetId,
      targetLabel: A.targetLabel,
      subjectName: subjectUser.name,
      diff: A.diff,
      ip: A.ip,
      userAgent: A.userAgent,
      requestId: A.requestId,
      result: A.result,
      reason: A.reason,
      cursorAt: sql<string>`to_char(${A.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(A)
    .leftJoin(actorUser, eq(actorUser.id, A.actorUserId))
    .leftJoin(proxyUser, eq(proxyUser.id, A.onBehalfOfUserId))
    .leftJoin(subjectUser, eq(subjectUser.id, A.subjectUserId))
    .where(and(...where))
    .orderBy(desc(A.occurredAt), desc(A.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  if (!cursor) {
    await recordAudit(ctx.tx, {
      accountId: ctx.accountId,
      actorUserId: ctx.userId,
      action: "audit.view_log",
      reason: JSON.stringify({ ...filters, from }),
      result: "success",
      request: ctx.request,
    });
  }
  return {
    items: page.map(({ cursorAt: _cursorAt, ...row }) => {
      const masked =
        !canSeeContent && row.targetType !== null && CONTENT_TARGETS.has(row.targetType);
      return masked ? { ...row, targetLabel: null, reason: null, masked } : { ...row, masked };
    }),
    nextCursor: rows.length > limit && last ? encodeCursor(last.cursorAt, last.id) : null,
  };
}

/** 최근 12개월의 점검 상태 (직전 달부터 최신순)와 점검 대상 달 */
export async function reviewOverview(ctx: ServiceContext, actor: Actor) {
  authorize(actor, "audit.read", ACCOUNT_TARGET);
  const R = schema.auditReview;
  const reviewer = alias(schema.user, "reviewer_user");
  const rows = await ctx.tx
    .select({
      id: R.id,
      period: R.period,
      reviewedAt: R.reviewedAt,
      memo: R.memo,
      abnormal: R.abnormal,
      abnormalNote: R.abnormalNote,
      reviewerName: reviewer.name,
    })
    .from(R)
    .innerJoin(schema.membership, eq(schema.membership.id, R.reviewerMembershipId))
    .innerJoin(reviewer, eq(reviewer.id, schema.membership.userId));
  const months = reviewStatuses(ctx.now, rows, REVIEW_MONTHS);
  const targetPeriod = reviewTargetPeriod(ctx.now);
  return {
    targetPeriod,
    overdue: months[0]?.state === "pending",
    months,
  };
}

export interface ReviewInput {
  period: string;
  memo?: string;
  abnormal: boolean;
  abnormalNote?: string;
}

/** "점검 완료"를 남긴다. 점검 대상은 최근 12개월의 지난 달이며, 같은 달에 다시 남기면 마지막 건이 현재 상태가 된다 */
export async function addReview(
  ctx: ServiceContext,
  actor: Actor,
  reviewerMembershipId: string,
  input: ReviewInput,
) {
  authorize(actor, "audit.read", ACCOUNT_TARGET);
  const allowed = reviewStatuses(ctx.now, [], REVIEW_MONTHS).map((m) => m.period);
  if (!allowed.includes(input.period)) {
    throw new ServiceError(
      "validation_failed",
      "점검할 수 없는 달입니다 (최근 12개월의 지난 달만)",
    );
  }
  const note = input.abnormalNote?.trim() ?? "";
  if (input.abnormal && note.length === 0) {
    throw new ServiceError("validation_failed", "이상이 있으면 내용을 적어야 합니다");
  }
  const [row] = await ctx.tx
    .insert(schema.auditReview)
    .values({
      accountId: ctx.accountId,
      period: input.period,
      reviewerMembershipId,
      memo: input.memo?.trim() || null,
      abnormal: input.abnormal,
      abnormalNote: input.abnormal ? note : null,
    })
    .returning({ id: schema.auditReview.id, reviewedAt: schema.auditReview.reviewedAt });
  if (!row) throw new Error("점검 기록 저장 실패");
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "audit.review",
    target: { type: "audit_review", id: row.id, label: input.period },
    reason: input.abnormal ? `이상 있음: ${note}` : "이상 없음",
    result: "success",
    request: ctx.request,
  });
  return { id: row.id, reviewedAt: row.reviewedAt };
}

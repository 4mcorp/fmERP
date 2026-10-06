// 결재 대기·기안함 (PRD APV-080 일부). 나머지 문서함은 M5.
import { schema } from "@fmerp/db";
import type { ServiceContext } from "@fmerp/shared/server/context";
import { and, desc, eq, sql } from "drizzle-orm";

/** 지금 내가 처리할 차례인 문서: 처리자이거나 대결자인 ACTIVE 단계. 보류 중인 문서도 처리자에게는 보인다 */
export async function listPending(ctx: ServiceContext, membershipId: string) {
  const rows = await ctx.tx
    .select({
      documentId: schema.document.id,
      title: schema.document.title,
      status: schema.document.status,
      urgent: schema.document.urgent,
      securityLevel: schema.document.securityLevel,
      docNo: schema.document.docNo,
      submittedAt: schema.document.submittedAt,
      drafterSnapshot: schema.document.drafterSnapshot,
      stepId: schema.approvalStep.id,
      stepType: schema.approvalStep.type,
      stepStatus: schema.approvalStep.status,
      stepVersion: schema.approvalStep.version,
      assigneeIds: schema.approvalStep.assigneeIds,
      delegates: schema.approvalStep.delegates,
    })
    .from(schema.approvalStep)
    .innerJoin(schema.document, eq(schema.document.id, schema.approvalStep.documentId))
    .where(
      and(
        sql`${schema.approvalStep.status} in ('ACTIVE', 'HELD')`,
        sql`${schema.document.status} in ('IN_PROGRESS', 'ON_HOLD')`,
        sql`(${membershipId} = any(${schema.approvalStep.assigneeIds})
          or exists (select 1 from jsonb_each_text(${schema.approvalStep.delegates}) d where d.value = ${membershipId}))`,
      ),
    )
    .orderBy(desc(schema.document.urgent), schema.document.submittedAt);
  return rows.map(({ assigneeIds, delegates, ...r }) => ({
    ...r,
    /** 대결자로서 처리하는 문서인지 */
    asDelegate:
      !assigneeIds.includes(membershipId) && Object.values(delegates).includes(membershipId),
  }));
}

/** 내가 기안한 문서: 임시저장·진행·회수·반려·완료 */
export function listMyDocuments(ctx: ServiceContext, membershipId: string) {
  return ctx.tx
    .select({
      id: schema.document.id,
      title: schema.document.title,
      status: schema.document.status,
      docNo: schema.document.docNo,
      urgent: schema.document.urgent,
      formCategory: schema.document.formCategory,
      supersedes: schema.document.supersedes,
      submittedAt: schema.document.submittedAt,
      updatedAt: schema.document.updatedAt,
    })
    .from(schema.document)
    .where(eq(schema.document.drafterMembershipId, membershipId))
    .orderBy(desc(schema.document.updatedAt))
    .limit(200);
}

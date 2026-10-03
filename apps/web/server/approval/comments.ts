// 단계별 의견 (PRD APV-042, APV-017). 추가만 가능하며 공개 범위(결재선 전체 / 기안자만)를 따른다.
import { recordAudit } from "@fmerp/audit";
import { schema } from "@fmerp/db";
import { asc, eq } from "drizzle-orm";
import type { ServiceContext } from "./context";
import { ApprovalError } from "./errors";
import { isParticipant } from "./service";

const MAX_COMMENT = 2000;

export async function addComment(
  ctx: ServiceContext,
  input: {
    documentId: string;
    authorMembershipId: string;
    body: string;
    visibility: "all" | "drafter";
    stepId?: string;
  },
) {
  const body = input.body.trim();
  if (body === "" || body.length > MAX_COMMENT) {
    throw new ApprovalError("comment_required", `의견은 1~${MAX_COMMENT}자로 입력하세요`);
  }
  if (!(await isParticipant(ctx, input.documentId, input.authorMembershipId))) {
    throw new ApprovalError("not_found", "문서를 찾을 수 없습니다");
  }
  if (input.stepId) {
    const [step] = await ctx.tx
      .select({ documentId: schema.approvalStep.documentId })
      .from(schema.approvalStep)
      .where(eq(schema.approvalStep.id, input.stepId));
    if (step?.documentId !== input.documentId) {
      throw new ApprovalError("step_not_found", "결재 단계를 찾을 수 없습니다");
    }
  }
  const [row] = await ctx.tx
    .insert(schema.approvalComment)
    .values({
      accountId: ctx.accountId,
      documentId: input.documentId,
      stepId: input.stepId,
      authorMembershipId: input.authorMembershipId,
      body,
      visibility: input.visibility,
    })
    .returning({ id: schema.approvalComment.id });
  if (!row) throw new Error("의견 저장 실패");
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "approval.comment",
    target: { type: "document", id: input.documentId },
    result: "success",
    request: ctx.request,
  });
  return { id: row.id };
}

/** 보는 사람에게 공개된 의견만: 기안자는 모두, 그 밖의 참여자는 전체 공개 의견과 본인이 쓴 의견 */
export async function listComments(
  ctx: ServiceContext,
  documentId: string,
  viewerMembershipId: string,
) {
  const [doc] = await ctx.tx
    .select({ drafter: schema.document.drafterMembershipId })
    .from(schema.document)
    .where(eq(schema.document.id, documentId));
  if (!doc || !(await isParticipant(ctx, documentId, viewerMembershipId))) {
    throw new ApprovalError("not_found", "문서를 찾을 수 없습니다");
  }
  const rows = await ctx.tx
    .select({
      id: schema.approvalComment.id,
      stepId: schema.approvalComment.stepId,
      authorMembershipId: schema.approvalComment.authorMembershipId,
      authorName: schema.user.name,
      body: schema.approvalComment.body,
      visibility: schema.approvalComment.visibility,
      createdAt: schema.approvalComment.createdAt,
    })
    .from(schema.approvalComment)
    .innerJoin(
      schema.membership,
      eq(schema.membership.id, schema.approvalComment.authorMembershipId),
    )
    .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId))
    .where(eq(schema.approvalComment.documentId, documentId))
    .orderBy(asc(schema.approvalComment.createdAt));
  const isDrafter = doc.drafter === viewerMembershipId;
  return rows.filter(
    (r) => isDrafter || r.visibility === "all" || r.authorMembershipId === viewerMembershipId,
  );
}

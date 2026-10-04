import {
  type Actor,
  can,
  canViewDocument,
  type DocumentViewFacts,
  type Recipient,
} from "@fmerp/core";
import { schema } from "@fmerp/db";
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { businessTarget, departmentTarget } from "../org-access";
import type { ServiceContext } from "./context";
import { ApprovalError } from "./errors";

/** 열람자: 구성원 id와 권한 판정용 Actor */
export interface Viewer {
  membershipId: string;
  actor: Actor;
}

/** 양식 버전의 `recipients` 설정에서 참조자가 보기 시작하는 시점을 읽는다. 지정이 없으면 상신 즉시다 */
function ccVisibleFrom(recipients: unknown): "submit" | "complete" {
  const v = (recipients as { ccVisibleFrom?: unknown } | null)?.ccVisibleFrom;
  return v === "complete" ? "complete" : "submit";
}

/** 열람 판정에 필요한 사실을 DB에서 모은다. 문서가 없으면 null (PERM-003) */
export async function loadViewFacts(
  ctx: ServiceContext,
  documentId: string,
  viewer: Viewer,
): Promise<DocumentViewFacts | null> {
  const { tx } = ctx;
  const [doc] = await tx
    .select({
      drafter: schema.document.drafterMembershipId,
      status: schema.document.status,
      securityLevel: schema.document.securityLevel,
      businessId: schema.document.businessId,
      formVersionId: schema.document.formVersionId,
    })
    .from(schema.document)
    .where(eq(schema.document.id, documentId));
  if (!doc) return null;

  const [steps, recipientRows, departments, version] = await Promise.all([
    tx
      .select({
        assigneeIds: schema.approvalStep.assigneeIds,
        delegates: schema.approvalStep.delegates,
      })
      .from(schema.approvalStep)
      .where(eq(schema.approvalStep.documentId, documentId)),
    tx
      .select()
      .from(schema.documentRecipient)
      .where(eq(schema.documentRecipient.documentId, documentId)),
    tx
      .select({ departmentId: schema.assignment.departmentId })
      .from(schema.assignment)
      .where(
        and(
          eq(schema.assignment.membershipId, viewer.membershipId),
          or(isNull(schema.assignment.validTo), gt(schema.assignment.validTo, ctx.now)),
        ),
      ),
    doc.formVersionId
      ? tx
          .select({ recipients: schema.formVersion.recipients })
          .from(schema.formVersion)
          .where(eq(schema.formVersion.id, doc.formVersionId))
      : Promise.resolve([]),
  ]);

  // 감사인의 범위는 사업자 또는 부서다. 부서 범위는 기안자가 소속된 부서(상위 부서 포함)로 판정한다
  const drafterDepartments = await tx
    .select({ departmentId: schema.assignment.departmentId })
    .from(schema.assignment)
    .where(
      and(
        eq(schema.assignment.membershipId, doc.drafter),
        eq(schema.assignment.businessId, doc.businessId),
        isNull(schema.assignment.validTo),
      ),
    );
  const readAllTargets = [
    businessTarget(doc.businessId),
    ...(await Promise.all(drafterDepartments.map((d) => departmentTarget(tx, d.departmentId)))),
  ];
  const hasReadAll = readAllTargets.some((t) => can(viewer.actor, "document.read_all", t));

  // 접수 전 열람 판정에 쓸 수신 부서장
  const receiveDepartments = recipientRows
    .filter((r) => r.kind === "receive" && r.targetDepartmentId)
    .map((r) => r.targetDepartmentId as string);
  const heads =
    receiveDepartments.length > 0
      ? await tx
          .select({ id: schema.department.id, head: schema.department.headMembershipId })
          .from(schema.department)
          .where(inArray(schema.department.id, receiveDepartments))
      : [];
  const headOf = new Map(heads.map((d) => [d.id, d.head]));

  const recipients: Recipient[] = recipientRows.map((r) => ({
    kind: r.kind,
    target: r.targetMembershipId
      ? { type: "member", id: r.targetMembershipId }
      : { type: "department", id: r.targetDepartmentId ?? "" },
    receivedByMembershipId: r.receivedByMembershipId,
    assigneeMembershipId: r.assigneeMembershipId,
    departmentHeadMembershipId: r.targetDepartmentId
      ? (headOf.get(r.targetDepartmentId) ?? null)
      : null,
  }));

  return {
    viewerMembershipId: viewer.membershipId,
    viewerDepartmentIds: departments.map((d) => d.departmentId),
    // 관리자라고 본문을 볼 수 있는 것은 아니다. read_all은 소유자·감사인뿐이다 (PRD 3.3 각주 1)
    hasReadAll,
    drafterMembershipId: doc.drafter,
    status: doc.status,
    securityLevel: doc.securityLevel,
    stepParticipantIds: steps.flatMap((s) => [...s.assigneeIds, ...Object.values(s.delegates)]),
    ccVisibleFrom: ccVisibleFrom(version[0]?.recipients),
    recipients,
  };
}

export async function canView(
  ctx: ServiceContext,
  documentId: string,
  viewer: Viewer,
): Promise<boolean> {
  const facts = await loadViewFacts(ctx, documentId, viewer);
  return facts !== null && canViewDocument(facts);
}

/** 열람할 수 없으면 문서가 있는지도 알려 주지 않는다 (404) */
export async function requireView(
  ctx: ServiceContext,
  documentId: string,
  viewer: Viewer,
): Promise<void> {
  if (!(await canView(ctx, documentId, viewer))) {
    throw new ApprovalError("not_found", "문서를 찾을 수 없습니다");
  }
}

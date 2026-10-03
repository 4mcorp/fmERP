// 참조·수신·공람 (PRD APV-070·072·073): 지정, 열람 기록, 접수, 배부
import { recordAudit } from "@fmerp/audit";
import { canDistribute, canReceive, type Recipient } from "@fmerp/core";
import { schema } from "@fmerp/db";
import { and, eq, inArray } from "drizzle-orm";
import { loadViewFacts, type Viewer } from "./access";
import type { ServiceContext } from "./context";
import { ApprovalError } from "./errors";

export type RecipientInput = {
  kind: "cc" | "receive" | "circulate";
  target: { type: "member" | "department"; id: string };
  /** 수신: 지정 담당자. 없으면 부서장이 접수한다 */
  assigneeMembershipId?: string | null;
};

const notFound = () => new ApprovalError("not_found", "문서를 찾을 수 없습니다");

const toRow = (ctx: ServiceContext, documentId: string, r: RecipientInput) => {
  if (r.kind === "receive" && r.target.type !== "department") {
    throw new ApprovalError("validation_failed", "수신 대상은 부서여야 합니다");
  }
  return {
    accountId: ctx.accountId,
    documentId,
    kind: r.kind,
    targetMembershipId: r.target.type === "member" ? r.target.id : null,
    targetDepartmentId: r.target.type === "department" ? r.target.id : null,
    assigneeMembershipId: r.kind === "receive" ? (r.assigneeMembershipId ?? null) : null,
  };
};

const keyOf = (r: RecipientInput) => `${r.kind}:${r.target.type}:${r.target.id}`;

/** 초안의 참조·수신·공람 대상을 통째로 바꾼다. 기안자만, 상신 뒤에는 DB 트리거가 막는다 */
export async function setRecipients(
  ctx: ServiceContext,
  input: { documentId: string; actorMembershipId: string; items: RecipientInput[] },
) {
  const { tx } = ctx;
  const [doc] = await tx
    .select({
      drafter: schema.document.drafterMembershipId,
      status: schema.document.status,
    })
    .from(schema.document)
    .where(eq(schema.document.id, input.documentId));
  if (!doc || doc.drafter !== input.actorMembershipId) throw notFound();
  if (doc.status !== "DRAFT") {
    throw new ApprovalError("invalid_state", "초안에서만 참조·수신 대상을 바꿀 수 있습니다");
  }
  const unique = [...new Map(input.items.map((i) => [keyOf(i), i])).values()];
  await tx
    .delete(schema.documentRecipient)
    .where(eq(schema.documentRecipient.documentId, input.documentId));
  if (unique.length > 0) {
    await tx
      .insert(schema.documentRecipient)
      .values(unique.map((r) => toRow(ctx, input.documentId, r)));
  }
  return { count: unique.length };
}

/** 완료된 문서를 사람·부서에게 공람으로 회람한다 (APV-072). 기안자 또는 결재선 참여자 */
export async function circulate(
  ctx: ServiceContext,
  input: { documentId: string; viewer: Viewer; targets: RecipientInput["target"][] },
) {
  const { tx } = ctx;
  const facts = await loadViewFacts(ctx, input.documentId, input.viewer);
  if (!facts) throw notFound();
  const involved =
    facts.drafterMembershipId === input.viewer.membershipId ||
    facts.stepParticipantIds.includes(input.viewer.membershipId);
  if (!involved) throw notFound();
  if (facts.status !== "COMPLETED") {
    throw new ApprovalError("invalid_state", "완료된 문서만 공람으로 회람할 수 있습니다");
  }
  const existing = await tx
    .select()
    .from(schema.documentRecipient)
    .where(
      and(
        eq(schema.documentRecipient.documentId, input.documentId),
        eq(schema.documentRecipient.kind, "circulate"),
      ),
    );
  const have = new Set(
    existing.map(
      (r) =>
        `${r.targetMembershipId ? "member" : "department"}:${r.targetMembershipId ?? r.targetDepartmentId}`,
    ),
  );
  const fresh = input.targets.filter((t) => !have.has(`${t.type}:${t.id}`));
  if (fresh.length > 0) {
    await tx
      .insert(schema.documentRecipient)
      .values(fresh.map((target) => toRow(ctx, input.documentId, { kind: "circulate", target })));
    await recordAudit(tx, {
      accountId: ctx.accountId,
      actorUserId: ctx.userId,
      action: "document.circulate",
      target: { type: "document", id: input.documentId, label: `${fresh.length}건` },
      result: "success",
      request: ctx.request,
    });
  }
  return { added: fresh.length };
}

/** 문서를 연 사람이 참조·공람 대상이면 열람 일시를 한 번 남긴다 (APV-072·073) */
export async function markRead(ctx: ServiceContext, documentId: string, viewer: Viewer) {
  const facts = await loadViewFacts(ctx, documentId, viewer);
  if (!facts) return;
  const rows = await ctx.tx
    .select({
      id: schema.documentRecipient.id,
      kind: schema.documentRecipient.kind,
      memberId: schema.documentRecipient.targetMembershipId,
      departmentId: schema.documentRecipient.targetDepartmentId,
    })
    .from(schema.documentRecipient)
    .where(eq(schema.documentRecipient.documentId, documentId));
  const mine = rows.filter(
    (r) =>
      r.kind !== "receive" &&
      (r.memberId === viewer.membershipId ||
        (r.departmentId !== null && facts.viewerDepartmentIds.includes(r.departmentId))),
  );
  if (mine.length === 0) return;
  // 열람할 수 있는 상태가 아닌 대상(예: 완료 전 공람)은 기록하지 않는다
  const visible = mine.filter((r) =>
    r.kind === "cc" ? facts.status !== "DRAFT" : facts.status === "COMPLETED",
  );
  if (visible.length === 0) return;
  await ctx.tx
    .insert(schema.documentRecipientRead)
    .values(
      visible.map((r) => ({
        accountId: ctx.accountId,
        recipientId: r.id,
        membershipId: viewer.membershipId,
        readAt: ctx.now,
      })),
    )
    .onConflictDoNothing();
}

/** 참조·수신·공람 대상과 열람·접수·배부 상태. 열람 일시는 기안자와 결재선 참여자에게만 보인다 */
export async function listRecipients(ctx: ServiceContext, documentId: string, viewer: Viewer) {
  const { tx } = ctx;
  const facts = await loadViewFacts(ctx, documentId, viewer);
  if (!facts) throw notFound();
  const rows = await tx
    .select()
    .from(schema.documentRecipient)
    .where(eq(schema.documentRecipient.documentId, documentId));
  const involved =
    facts.drafterMembershipId === viewer.membershipId ||
    facts.stepParticipantIds.includes(viewer.membershipId);

  const recipientIds = rows.map((r) => r.id);
  const [reads, distributions, members, departments] = await Promise.all([
    involved && recipientIds.length > 0
      ? tx
          .select()
          .from(schema.documentRecipientRead)
          .where(inArray(schema.documentRecipientRead.recipientId, recipientIds))
      : Promise.resolve([]),
    recipientIds.length > 0
      ? tx
          .select()
          .from(schema.documentDistribution)
          .where(inArray(schema.documentDistribution.recipientId, recipientIds))
      : Promise.resolve([]),
    tx
      .select({ id: schema.membership.id, name: schema.user.name })
      .from(schema.membership)
      .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId)),
    tx.select({ id: schema.department.id, name: schema.department.name }).from(schema.department),
  ]);
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    targetType: r.targetMembershipId ? ("member" as const) : ("department" as const),
    targetId: r.targetMembershipId ?? r.targetDepartmentId ?? "",
    targetName: r.targetMembershipId
      ? (memberName.get(r.targetMembershipId) ?? "")
      : (departmentName.get(r.targetDepartmentId ?? "") ?? ""),
    assigneeName: r.assigneeMembershipId ? (memberName.get(r.assigneeMembershipId) ?? "") : null,
    receivedByName: r.receivedByMembershipId
      ? (memberName.get(r.receivedByMembershipId) ?? "")
      : null,
    receivedAt: r.receivedAt,
    reads: reads
      .filter((x) => x.recipientId === r.id)
      .map((x) => ({
        membershipId: x.membershipId,
        name: memberName.get(x.membershipId) ?? "",
        readAt: x.readAt,
      })),
    distributedTo: distributions
      .filter((x) => x.recipientId === r.id)
      .map((x) => ({ membershipId: x.membershipId, name: memberName.get(x.membershipId) ?? "" })),
  }));
}

async function loadReceive(ctx: ServiceContext, recipientId: string) {
  const [row] = await ctx.tx
    .select()
    .from(schema.documentRecipient)
    .where(eq(schema.documentRecipient.id, recipientId));
  if (row?.kind !== "receive") throw notFound();
  const [doc] = await ctx.tx
    .select({ status: schema.document.status })
    .from(schema.document)
    .where(eq(schema.document.id, row.documentId));
  if (!doc) throw notFound();
  const recipient: Recipient = {
    kind: row.kind,
    target: { type: "department", id: row.targetDepartmentId ?? "" },
    receivedByMembershipId: row.receivedByMembershipId,
    assigneeMembershipId: row.assigneeMembershipId,
  };
  return { row, status: doc.status, recipient };
}

/** 수신 접수 (APV-070): 지정 담당자(없으면 부서장)만, 한 번만 */
export async function receiveDocument(
  ctx: ServiceContext,
  input: { recipientId: string; viewerMembershipId: string },
) {
  const { row, status, recipient } = await loadReceive(ctx, input.recipientId);
  const [dept] = await ctx.tx
    .select({ head: schema.department.headMembershipId })
    .from(schema.department)
    .where(eq(schema.department.id, row.targetDepartmentId ?? ""));
  const allowed = canReceive({
    status,
    recipient,
    viewerMembershipId: input.viewerMembershipId,
    departmentHeadMembershipId: dept?.head ?? null,
  });
  if (!allowed) {
    // 접수 담당자가 아니면 수신 건이 있는지도 알려 주지 않는다. 담당자인데 이미 접수했거나 완료 전이면 상태 오류다
    const receiver = recipient.assigneeMembershipId ?? dept?.head ?? null;
    if (receiver === input.viewerMembershipId) {
      throw new ApprovalError("invalid_state", "접수할 수 없는 상태입니다");
    }
    throw notFound();
  }
  await ctx.tx
    .update(schema.documentRecipient)
    .set({ receivedByMembershipId: input.viewerMembershipId, receivedAt: ctx.now })
    .where(eq(schema.documentRecipient.id, input.recipientId));
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "document.receive",
    target: { type: "document", id: row.documentId, label: "수신 접수" },
    result: "success",
    request: ctx.request,
  });
}

/** 배부 (APV-070): 접수자가 수신 부서 안의 구성원에게 넘긴다 */
export async function distributeDocument(
  ctx: ServiceContext,
  input: { recipientId: string; viewerMembershipId: string; membershipIds: string[] },
) {
  const { row, recipient } = await loadReceive(ctx, input.recipientId);
  if (recipient.receivedByMembershipId !== input.viewerMembershipId) throw notFound();
  const unique = [...new Set(input.membershipIds)];
  const assignments = await ctx.tx
    .select({
      membershipId: schema.assignment.membershipId,
      departmentId: schema.assignment.departmentId,
    })
    .from(schema.assignment)
    .where(inArray(schema.assignment.membershipId, unique));
  for (const id of unique) {
    const departmentIds = assignments
      .filter((a) => a.membershipId === id)
      .map((a) => a.departmentId);
    if (
      !canDistribute({
        recipient,
        viewerMembershipId: input.viewerMembershipId,
        targetDepartmentIds: departmentIds,
      })
    ) {
      throw new ApprovalError(
        "validation_failed",
        "수신 부서 소속이 아닌 구성원에게는 배부할 수 없습니다",
      );
    }
  }
  await ctx.tx
    .insert(schema.documentDistribution)
    .values(
      unique.map((membershipId) => ({
        accountId: ctx.accountId,
        recipientId: input.recipientId,
        membershipId,
        distributedByMembershipId: input.viewerMembershipId,
      })),
    )
    .onConflictDoNothing();
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "document.distribute",
    target: { type: "document", id: row.documentId, label: `${unique.length}명에게 배부` },
    result: "success",
    request: ctx.request,
  });
  return { count: unique.length };
}

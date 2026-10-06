// 진행 중 결재선 변경 (PRD APV-037, M3 FU-13): 현재 처리자 또는 결재 관리자가, 양식이 허용할 때,
// 처리 전(PENDING)인 이후 단계만 추가·삭제한다. 사유는 필수이며 감사 로그와 이벤트에 남는다.
import { randomUUID } from "node:crypto";
import { recordAudit } from "@fmerp/audit";
import {
  type ApprovalActor,
  type DraftLineItem,
  editLine,
  type LineEdit,
  resolveLine,
  validateLine,
} from "@fmerp/core";
import { schema } from "@fmerp/db";
import type { ServiceContext } from "@fmerp/shared/server/context";
import { ServiceError } from "@fmerp/shared/server/errors";
import { and, eq } from "drizzle-orm";
import { getFormVersion } from "./forms";
import { loadAuditorIds, loadMemberCards, loadOrgSnapshot } from "./org-snapshot";
import { lockAndLoad } from "./store";

export type LineChangeInput =
  | { kind: "add"; item: Omit<DraftLineItem, "canFinalize"> }
  | { kind: "remove"; stepId: string };

export async function changeLine(
  ctx: ServiceContext,
  input: {
    documentId: string;
    actor: ApprovalActor;
    edits: LineChangeInput[];
    reason: string;
  },
) {
  const loaded = await lockAndLoad(ctx.tx, input.documentId);
  const { row } = loaded;
  const version = row.formVersionId ? await getFormVersion(ctx.tx, row.formVersionId) : null;
  const allowLineEdit = version?.allowLineEdit ?? false;

  // 추가 대상을 사용자로 해석한다. 후결 단계는 추가할 수 없다 (M3 FU-12), 전결 권한은 줄 수 없다
  const org = await loadOrgSnapshot(ctx.tx);
  const [drafterAssignment] = org.assignments.filter(
    (a) => a.membershipId === row.drafterMembershipId && a.businessId === row.businessId,
  );
  const added = input.edits.filter(
    (e): e is Extract<LineChangeInput, { kind: "add" }> => e.kind === "add",
  );
  if (added.some((e) => e.item.type === "post")) {
    throw new ServiceError("line_invalid", "진행 중에는 후결 단계를 추가할 수 없습니다");
  }
  const resolved =
    added.length === 0
      ? { ok: true as const, steps: [] }
      : resolveLine(
          added.map((e) => ({ ...e.item, canFinalize: false })),
          org,
          {
            membershipId: row.drafterMembershipId,
            departmentId: drafterAssignment?.departmentId ?? "",
          },
        );
  if (!resolved.ok) {
    throw new ServiceError("line_invalid", "추가할 결재선을 해석할 수 없습니다", {
      errors: resolved.errors,
    });
  }

  const newIds: string[] = [];
  let addIndex = 0;
  const edits: LineEdit[] = input.edits.map((e) => {
    if (e.kind === "remove") return e;
    const step = resolved.steps[addIndex++];
    const id = randomUUID();
    newIds.push(id);
    return {
      kind: "add" as const,
      step: {
        id,
        seq: e.item.seq,
        type: e.item.type,
        assigneeIds: step?.assigneeIds ?? [],
        quorum: e.item.quorum,
      },
    };
  });

  const result = editLine(loaded.doc, edits, input.actor, { reason: input.reason, allowLineEdit });
  if (!result.ok) throw new ServiceError(result.code, result.message);

  // 변경 후 결재선이 검증을 통과해야 한다 (비활성 사용자 등)
  const inactive = new Set(
    org.members.filter((m) => m.status !== "active").map((m) => m.membershipId),
  );
  const validation = validateLine(
    result.doc.steps.map((s) => ({
      type: s.type,
      seq: s.seq,
      assigneeIds: s.assigneeIds,
      quorum: s.quorum,
    })),
    {
      drafterId: row.drafterMembershipId,
      allowDuplicate: true,
      ranks: new Map(),
      inactive,
      auditors: await loadAuditorIds(ctx.tx),
    },
  );
  if (validation.errors.length > 0) {
    throw new ServiceError("line_invalid", validation.errors.join("; "), {
      errors: validation.errors,
    });
  }

  // 저장: 삭제 → 추가 (DB 트리거가 진행 중 PENDING 단계의 추가·삭제만 허용한다)
  for (const id of result.removedStepIds) {
    await ctx.tx
      .delete(schema.approvalStep)
      .where(and(eq(schema.approvalStep.id, id), eq(schema.approvalStep.documentId, row.id)));
  }
  const cards = await loadMemberCards(
    ctx.tx,
    result.doc.steps
      .filter((s) => result.addedStepIds.includes(s.id))
      .flatMap((s) => s.assigneeIds),
  );
  for (const id of result.addedStepIds) {
    const s = result.doc.steps.find((x) => x.id === id);
    if (!s) continue;
    await ctx.tx.insert(schema.approvalStep).values({
      id: s.id,
      accountId: ctx.accountId,
      documentId: row.id,
      seq: s.seq,
      type: s.type,
      assigneeIds: s.assigneeIds,
      assigneeSnapshot: s.assigneeIds.map(
        (a) => (cards.get(a) ?? { membershipId: a }) as unknown as Record<string, unknown>,
      ),
      canFinalize: false,
      quorum: s.quorum === "all" ? null : s.quorum,
    });
  }
  await ctx.tx.insert(schema.approvalEvent).values(
    result.events.map((e) => ({
      accountId: ctx.accountId,
      documentId: row.id,
      type: e.type,
      payload: e as unknown as Record<string, unknown>,
    })),
  );
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "approval.line_change",
    target: { type: "document", id: row.id, label: row.title },
    reason: input.reason.trim(),
    result: "success",
    request: ctx.request,
  });
  return { addedStepIds: result.addedStepIds, removedStepIds: result.removedStepIds };
}

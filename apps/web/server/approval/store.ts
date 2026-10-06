import type { ApprovalDoc, ApprovalStep, EngineResult } from "@fmerp/core";
import { schema, type Tx } from "@fmerp/db";
import { ServiceError } from "@fmerp/shared/server/errors";
import { and, asc, eq } from "drizzle-orm";

type DocRow = typeof schema.document.$inferSelect;
type StepRow = typeof schema.approvalStep.$inferSelect;

export interface LoadedDocument {
  doc: ApprovalDoc;
  row: DocRow;
  stepRows: StepRow[];
}

const toStep = (r: StepRow): ApprovalStep => ({
  id: r.id,
  seq: r.seq,
  type: r.type,
  assigneeIds: r.assigneeIds,
  delegates: r.delegates,
  canFinalize: r.canFinalize,
  quorum: r.quorum ?? "all",
  status: r.status,
  version: r.version,
  heldBy: r.heldBy,
});

/**
 * 문서 행을 잠그고(`FOR UPDATE`) 단계까지 읽어 엔진 입력으로 만든다.
 * 같은 문서의 처리를 직렬화해야 병렬 그룹의 두 처리가 서로의 결과를 놓치지 않는다 (APV-045).
 */
export async function lockAndLoad(tx: Tx, documentId: string): Promise<LoadedDocument> {
  const [row] = await tx
    .select()
    .from(schema.document)
    .where(eq(schema.document.id, documentId))
    .for("update");
  if (!row) throw new ServiceError("not_found", "문서를 찾을 수 없습니다");
  const stepRows = await tx
    .select()
    .from(schema.approvalStep)
    .where(eq(schema.approvalStep.documentId, documentId))
    .orderBy(asc(schema.approvalStep.seq), asc(schema.approvalStep.id));
  return {
    row,
    stepRows,
    doc: {
      id: row.id,
      status: row.status,
      drafterId: row.drafterMembershipId,
      policy: row.policy,
      steps: stepRows.map(toStep),
    },
  };
}

/** 엔진 결과를 저장한다: 바뀐 단계는 낙관적 잠금으로, 문서 상태·이벤트·처리 기록은 같은 트랜잭션에서 */
export async function persistResult(
  tx: Tx,
  loaded: LoadedDocument,
  result: Extract<EngineResult, { ok: true }>,
  docPatch: Partial<typeof schema.document.$inferInsert>,
  idempotencyKey: string | null,
  request: { ip?: string | null; userAgent?: string | null },
  docHash: string | null = null,
): Promise<void> {
  const { row } = loaded;
  const before = new Map(loaded.doc.steps.map((s) => [s.id, s]));
  // 단계를 먼저 바꾼다: 문서가 완료 상태가 되기 전이어야 불변 트리거를 통과한다
  for (const id of result.changedStepIds) {
    const after = result.doc.steps.find((s) => s.id === id);
    const old = before.get(id);
    if (!after || !old) continue;
    const updated = await tx
      .update(schema.approvalStep)
      .set({
        status: after.status,
        version: after.version,
        delegates: after.delegates,
        heldBy: after.heldBy,
      })
      .where(and(eq(schema.approvalStep.id, id), eq(schema.approvalStep.version, old.version)))
      .returning({ id: schema.approvalStep.id });
    if (updated.length === 0) {
      throw new ServiceError(
        "version_conflict",
        "다른 처리와 충돌했습니다. 새로고침 후 다시 시도하세요",
      );
    }
  }
  if (result.doc.status !== loaded.doc.status || Object.keys(docPatch).length > 0) {
    await tx
      .update(schema.document)
      .set({ status: result.doc.status, ...docPatch })
      .where(eq(schema.document.id, row.id));
  }
  if (result.record && idempotencyKey) {
    await tx.insert(schema.approvalAction).values({
      accountId: row.accountId,
      documentId: row.id,
      stepId: result.record.stepId,
      actorMembershipId: result.record.actorId,
      onBehalfOfMembershipId: result.record.onBehalfOf,
      action: result.record.action,
      comment: result.record.comment,
      idempotencyKey,
      docHash,
      ip: request.ip ?? null,
      userAgent: request.userAgent ?? null,
    });
  }
  if (result.events.length > 0) {
    await tx.insert(schema.approvalEvent).values(
      result.events.map((e) => ({
        accountId: row.accountId,
        documentId: row.id,
        type: e.type,
        payload: e as unknown as Record<string, unknown>,
      })),
    );
  }
}

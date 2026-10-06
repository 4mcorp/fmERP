import type { ApprovalDoc } from "./approval-types";

/** 결재자 일괄 이관 (PRD ADM-005, ORG-036). 처리 전 단계의 처리자만 바꾸고 처리된 단계는 보호한다. */

type TransferErrorCode = "invalid_state" | "reason_required" | "invalid_transfer";

export type TransferPlan =
  | { ok: true; changes: { stepId: string; assigneeIds: string[] }[] }
  | { ok: false; code: TransferErrorCode; message: string };

const OPEN_STEP = new Set(["PENDING", "ACTIVE", "HELD"]);

export function planTransfer(
  doc: ApprovalDoc,
  input: { from: string; to: string; reason: string },
): TransferPlan {
  if (input.reason.trim() === "") {
    return { ok: false, code: "reason_required", message: "이관 사유를 입력하세요" };
  }
  if (input.from === input.to) {
    return { ok: false, code: "invalid_transfer", message: "같은 사람에게는 이관할 수 없습니다" };
  }
  if (doc.status !== "IN_PROGRESS" && doc.status !== "ON_HOLD") {
    return { ok: false, code: "invalid_state", message: "진행 중인 문서만 이관할 수 있습니다" };
  }

  const changes: { stepId: string; assigneeIds: string[] }[] = [];
  for (const step of doc.steps) {
    if (!OPEN_STEP.has(step.status) || !step.assigneeIds.includes(input.from)) continue;
    const already = step.assigneeIds.includes(input.to);
    const assigneeIds = step.assigneeIds.flatMap((id) => {
      if (id !== input.from) return [id];
      return already ? [] : [input.to];
    });
    changes.push({ stepId: step.id, assigneeIds });
  }
  return { ok: true, changes };
}

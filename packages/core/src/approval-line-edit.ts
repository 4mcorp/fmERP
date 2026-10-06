import type {
  ApprovalActor,
  ApprovalDoc,
  ApprovalEvent,
  ApprovalStep,
  StepType,
} from "./approval-types";

/** 진행 중 결재선 변경 (PRD APV-037, M3 후속 FU-13). 처리 전(PENDING)인 이후 단계만 추가·삭제한다. */

export interface NewStep {
  id: string;
  seq: number;
  type: StepType;
  assigneeIds: string[];
  canFinalize?: boolean;
  quorum?: "all" | number;
}

export type LineEdit = { kind: "add"; step: NewStep } | { kind: "remove"; stepId: string };

import type { LineEditErrorCode } from "./engine-error-code";

export type LineEditResult =
  | {
      ok: true;
      doc: ApprovalDoc;
      events: ApprovalEvent[];
      addedStepIds: string[];
      removedStepIds: string[];
    }
  | { ok: false; code: LineEditErrorCode; message: string };

const fail = (code: LineEditErrorCode, message: string): LineEditResult => ({
  ok: false,
  code,
  message,
});

export function editLine(
  doc: ApprovalDoc,
  edits: LineEdit[],
  actor: ApprovalActor,
  opts: { reason: string; allowLineEdit: boolean },
): LineEditResult {
  if (!opts.allowLineEdit)
    return fail("line_edit_not_allowed", "이 양식은 진행 중 결재선 변경을 허용하지 않습니다");
  if (doc.status !== "IN_PROGRESS" && doc.status !== "ON_HOLD") {
    return fail("invalid_state", "진행 중인 문서의 결재선만 변경할 수 있습니다");
  }
  const working = doc.steps.filter((s) => s.status === "ACTIVE" || s.status === "HELD");
  const isCurrent = working.some(
    (s) =>
      s.assigneeIds.includes(actor.membershipId) ||
      Object.values(s.delegates).includes(actor.membershipId),
  );
  if (!isCurrent && !actor.isApprovalAdmin) {
    return fail("not_assignee", "현재 처리자 또는 결재 관리자만 결재선을 변경할 수 있습니다");
  }
  if (opts.reason.trim() === "") return fail("reason_required", "변경 사유를 입력하세요");
  if (edits.length === 0) return fail("invalid_edit", "변경할 내용이 없습니다");

  const steps: ApprovalStep[] = doc.steps.map((s) => ({
    ...s,
    assigneeIds: [...s.assigneeIds],
    delegates: { ...s.delegates },
  }));
  // 이미 열렸거나 끝난 순번: 그 이전에는 끼어들 수 없다
  const floor = Math.max(
    0,
    ...doc.steps.filter((s) => s.type !== "post" && s.status !== "PENDING").map((s) => s.seq),
  );
  const added: string[] = [];
  const removed: string[] = [];

  for (const edit of edits) {
    if (edit.kind === "remove") {
      const idx = steps.findIndex((s) => s.id === edit.stepId);
      const target = steps[idx];
      if (!target) return fail("invalid_edit", "삭제할 단계를 찾을 수 없습니다");
      if (target.status !== "PENDING")
        return fail("invalid_edit", "아직 처리하지 않은 단계만 삭제할 수 있습니다");
      steps.splice(idx, 1);
      removed.push(target.id);
      continue;
    }
    const s = edit.step;
    if (steps.some((x) => x.id === s.id)) return fail("invalid_edit", "이미 있는 단계 id입니다");
    if (s.assigneeIds.length === 0) return fail("invalid_edit", "처리자가 필요합니다");
    if (s.type !== "post" && s.seq <= floor) {
      return fail("invalid_edit", "이미 진행 중이거나 끝난 순번 앞에는 단계를 추가할 수 없습니다");
    }
    steps.push({
      id: s.id,
      seq: s.seq,
      type: s.type,
      assigneeIds: [...s.assigneeIds],
      delegates: {},
      canFinalize: s.canFinalize ?? false,
      quorum: s.quorum ?? "all",
      status: "PENDING",
      version: 0,
      heldBy: null,
    });
    added.push(s.id);
  }

  steps.sort((a, b) => a.seq - b.seq);
  return {
    ok: true,
    doc: { ...doc, steps },
    events: [{ type: "line_changed", docId: doc.id, added, removed, reason: opts.reason.trim() }],
    addedStepIds: added,
    removedStepIds: removed,
  };
}

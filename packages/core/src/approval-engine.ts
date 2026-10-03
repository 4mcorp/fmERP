import { assertTransition, canTransition } from "./approval-state";
import type {
  ActionRecord,
  ApprovalAction,
  ApprovalActor,
  ApprovalDoc,
  ApprovalEvent,
  ApprovalStep,
  DocStatus,
  EngineContext,
  EngineErrorCode,
  EngineResult,
  StepStatus,
} from "./approval-types";

/**
 * 결재 엔진 (ADR 0007). 부수효과 없는 순수 함수: (문서, 행위, 행위자, 컨텍스트) → 새 문서 + 이벤트 + 처리 기록.
 * 시각·대결자 조회는 컨텍스트로 받는다. 입력 문서는 바꾸지 않는다.
 */

const FLOW_DONE: readonly StepStatus[] = ["APPROVED", "DELEGATED"];

const fail = (code: EngineErrorCode, message: string): EngineResult => ({
  ok: false,
  code,
  message,
});

/** 한 번의 엔진 호출 동안 문서를 바꾸는 작업대. 단계가 바뀔 때마다 version을 올리고 바뀐 단계를 기억한다 */
class Draft {
  readonly doc: ApprovalDoc;
  readonly events: ApprovalEvent[] = [];
  private readonly changed = new Set<string>();

  constructor(
    source: ApprovalDoc,
    private readonly ctx: EngineContext,
  ) {
    this.doc = structuredClone(source);
  }

  step(id: string): ApprovalStep | undefined {
    return this.doc.steps.find((s) => s.id === id);
  }

  setStatus(step: ApprovalStep, status: StepStatus) {
    step.status = status;
    this.touch(step);
  }

  touch(step: ApprovalStep) {
    step.version += 1;
    this.changed.add(step.id);
  }

  setDocStatus(to: DocStatus) {
    assertTransition(this.doc.status, to);
    this.doc.status = to;
  }

  /** 진행에 관여하는 단계(후결 제외)를 seq 순 그룹으로 묶는다 */
  flowGroups(): ApprovalStep[][] {
    const groups = new Map<number, ApprovalStep[]>();
    for (const s of this.doc.steps) {
      if (s.type === "post") continue;
      groups.set(s.seq, [...(groups.get(s.seq) ?? []), s]);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, steps]) => steps);
  }

  activate(step: ApprovalStep) {
    step.delegates = {};
    const delegateIds: string[] = [];
    for (const assignee of step.assigneeIds) {
      const decision = this.ctx.decideDelegate(assignee);
      if (decision.kind === "delegate") {
        step.delegates[assignee] = decision.delegateId;
        delegateIds.push(decision.delegateId);
      } else if (decision.kind === "unavailable") {
        this.events.push({
          type: "delegate_unavailable",
          docId: this.doc.id,
          stepId: step.id,
          assigneeId: assignee,
          delegateId: decision.delegateId,
        });
      }
    }
    this.setStatus(step, "ACTIVE");
    this.events.push({
      type: "step_activated",
      docId: this.doc.id,
      stepId: step.id,
      assigneeIds: [...step.assigneeIds],
      delegateIds,
    });
  }

  /** 문서를 완료하고 후결 단계를 연다 */
  complete() {
    this.setDocStatus("COMPLETED");
    this.events.push({ type: "completed", docId: this.doc.id });
    for (const s of this.doc.steps) {
      if (s.type === "post" && s.status === "PENDING") {
        this.setStatus(s, "POST_PENDING");
        this.events.push({
          type: "post_pending",
          docId: this.doc.id,
          stepId: s.id,
          assigneeIds: [...s.assigneeIds],
        });
      }
    }
  }

  /** 끝난 그룹을 넘기고 다음 그룹을 활성화한다. 모두 끝나면 문서를 완료한다 */
  advance() {
    for (const group of this.flowGroups()) {
      const quorumSpec = group[0]?.quorum ?? "all";
      const completed = group.filter((s) => FLOW_DONE.includes(s.status)).length;
      const quorum = quorumSpec === "all" ? group.length : Math.min(quorumSpec, group.length);
      const open = group.filter(
        (s) => s.status === "PENDING" || s.status === "ACTIVE" || s.status === "HELD",
      );
      const done =
        quorumSpec === "all" ? open.length === 0 : completed >= quorum || open.length === 0;
      if (done) {
        for (const s of open) this.setStatus(s, "SKIPPED");
        continue;
      }
      if (!open.some((s) => s.status === "ACTIVE" || s.status === "HELD")) {
        for (const s of open) this.activate(s);
      }
      return;
    }
    this.complete();
  }

  result(record: ActionRecord | null): EngineResult {
    return {
      ok: true,
      doc: this.doc,
      events: this.events,
      record,
      changedStepIds: [...this.changed],
    };
  }
}

/** 처리자 확인: 직접 처리자이거나 활성화 때 정해진 대결자이면 허용한다 */
function identify(step: ApprovalStep, actorId: string): { onBehalfOf: string | null } | null {
  if (step.assigneeIds.includes(actorId)) return { onBehalfOf: null };
  const principal = Object.entries(step.delegates).find(
    ([, delegate]) => delegate === actorId,
  )?.[0];
  return principal ? { onBehalfOf: principal } : null;
}

const needsComment = (action: ApprovalAction) =>
  action.kind === "reject" ||
  action.kind === "disagree" ||
  action.kind === "audit_reject" ||
  action.kind === "audit_comment";

/** 단계 유형별로 허용되는 행위 */
function allowedKinds(step: ApprovalStep, doc: ApprovalDoc): ApprovalAction["kind"][] {
  switch (step.type) {
    case "approve":
      return step.canFinalize
        ? ["approve", "reject", "hold", "finalize"]
        : ["approve", "reject", "hold"];
    case "agree":
    case "cooperate":
      return ["agree", "disagree", "hold"];
    case "audit":
      return doc.policy.auditCanReject
        ? ["audit_approve", "audit_reject", "audit_comment", "hold"]
        : ["audit_comment", "hold"];
    case "post":
      return ["post_approve"];
  }
}

const COMPLETING: ApprovalAction["kind"][] = ["approve", "agree", "audit_approve", "audit_comment"];

/** 처리 시각 이후의 반려 처리: 기안자에게 반려하거나, 직전 결재 단계를 다시 활성화한다 (APV-041) */
function applyRejection(d: Draft, step: ApprovalStep, comment: string) {
  d.setStatus(step, "REJECTED");
  d.events.push({ type: "rejected", docId: d.doc.id, stepId: step.id, comment });
  const previous =
    d.doc.policy.rejectTo === "previous"
      ? d.doc.steps
          .filter((s) => s.type === "approve" && s.seq < step.seq && FLOW_DONE.includes(s.status))
          .sort((a, b) => b.seq - a.seq)[0]
      : undefined;
  if (!previous) {
    d.setDocStatus("REJECTED");
    return;
  }
  // 직전 결재 단계로 되돌린다: 그 이후 흐름 단계는 처음부터 다시 진행한다 (처리 기록은 별도로 남아 있다)
  for (const s of d.doc.steps) {
    if (s.type !== "post" && s.seq > previous.seq && s.status !== "PENDING")
      d.setStatus(s, "PENDING");
  }
  d.activate(previous);
  d.events.push({ type: "reactivated", docId: d.doc.id, stepId: previous.id });
}

export function submit(doc: ApprovalDoc, ctx: EngineContext): EngineResult {
  if (doc.status !== "DRAFT") return fail("invalid_state", "초안 상태에서만 상신할 수 있습니다");
  if (!doc.steps.some((s) => s.type !== "post")) {
    return fail("nothing_to_submit", "결재 단계가 없습니다");
  }
  const d = new Draft(doc, ctx);
  for (const s of d.doc.steps) {
    if (s.status !== "PENDING") {
      s.status = "PENDING";
      d.touch(s);
    }
  }
  d.setDocStatus("IN_PROGRESS");
  d.events.push({ type: "submitted", docId: doc.id });
  d.advance();
  return d.result(null);
}

export function act(
  doc: ApprovalDoc,
  stepId: string,
  action: ApprovalAction,
  actor: ApprovalActor,
  ctx: EngineContext,
  expectedVersion?: number,
): EngineResult {
  const original = doc.steps.find((s) => s.id === stepId);
  if (!original) return fail("step_not_found", "결재 단계를 찾을 수 없습니다");
  if (expectedVersion !== undefined && original.version !== expectedVersion) {
    return fail("version_conflict", "다른 처리와 충돌했습니다. 새로고침 후 다시 시도하세요");
  }

  // 후결 승인: 문서가 완료된 뒤에 허용되는 유일한 추가 기록 (APV-062)
  if (action.kind === "post_approve") {
    if (
      doc.status !== "COMPLETED" ||
      original.type !== "post" ||
      original.status !== "POST_PENDING"
    ) {
      return fail("invalid_state", "후결을 처리할 수 없는 상태입니다");
    }
    const who = identify(original, actor.membershipId);
    if (!who) return fail("not_assignee", "처리 권한이 없습니다");
    const d = new Draft(doc, ctx);
    const step = d.step(stepId) as ApprovalStep;
    d.setStatus(step, "POST_APPROVED");
    d.events.push({ type: "post_approved", docId: doc.id, stepId });
    return d.result(record(stepId, action, actor, who.onBehalfOf, ctx.now));
  }

  // 보류 해제: 처리자 또는 결재 관리자
  if (action.kind === "release") {
    if (doc.status !== "ON_HOLD" || original.status !== "HELD") {
      return fail("invalid_state", "보류 상태가 아닙니다");
    }
    const who = identify(original, actor.membershipId);
    if (!who && !actor.isApprovalAdmin) return fail("not_assignee", "처리 권한이 없습니다");
    const d = new Draft(doc, ctx);
    const step = d.step(stepId) as ApprovalStep;
    step.heldBy = null;
    d.setStatus(step, "ACTIVE");
    d.setDocStatus("IN_PROGRESS");
    d.events.push({ type: "released", docId: doc.id, stepId });
    return d.result(record(stepId, action, actor, who?.onBehalfOf ?? null, ctx.now));
  }

  if (doc.status !== "IN_PROGRESS") return fail("invalid_state", "진행 중인 문서가 아닙니다");
  if (original.status !== "ACTIVE") return fail("step_not_active", "지금 처리할 차례가 아닙니다");
  const who = identify(original, actor.membershipId);
  if (!who) return fail("not_assignee", "처리 권한이 없습니다");
  if (!allowedKinds(original, doc).includes(action.kind)) {
    return fail("action_not_allowed", "이 단계에서 할 수 없는 처리입니다");
  }
  if (action.kind === "finalize" && who.onBehalfOf) {
    return fail("action_not_allowed", "대결자는 전결할 수 없습니다");
  }
  if (needsComment(action) && !("comment" in action && action.comment.trim())) {
    return fail("comment_required", "사유(의견)를 입력하세요");
  }

  const d = new Draft(doc, ctx);
  const step = d.step(stepId) as ApprovalStep;
  const comment = "comment" in action ? (action.comment?.trim() ?? null) : null;
  const doneStatus: StepStatus = who.onBehalfOf ? "DELEGATED" : "APPROVED";

  if (action.kind === "hold") {
    step.heldBy = actor.membershipId;
    d.setStatus(step, "HELD");
    d.setDocStatus("ON_HOLD");
    d.events.push({ type: "held", docId: doc.id, stepId });
  } else if (action.kind === "reject" || action.kind === "audit_reject") {
    applyRejection(d, step, comment ?? "");
  } else if (action.kind === "disagree") {
    // 협조는 반려하지 않는다. 합의는 양식 정책에 따른다
    if (step.type === "agree" && d.doc.policy.disagree === "reject") {
      applyRejection(d, step, comment ?? "");
    } else {
      d.setStatus(step, doneStatus);
      d.advance();
    }
  } else if (action.kind === "finalize") {
    d.setStatus(step, doneStatus);
    for (const s of d.doc.steps) {
      if (
        s.type !== "post" &&
        s.id !== step.id &&
        s.status !== "APPROVED" &&
        s.status !== "DELEGATED"
      ) {
        if (s.seq >= step.seq && (s.status === "PENDING" || s.status === "ACTIVE"))
          d.setStatus(s, "SKIPPED");
      }
    }
    d.complete();
  } else if (COMPLETING.includes(action.kind)) {
    d.setStatus(step, doneStatus);
    d.advance();
  }
  return d.result(record(stepId, action, actor, who.onBehalfOf, ctx.now, comment));
}

function record(
  stepId: string,
  action: ApprovalAction,
  actor: ApprovalActor,
  onBehalfOf: string | null,
  at: Date,
  comment?: string | null,
): ActionRecord {
  return {
    stepId,
    action: action.kind,
    actorId: actor.membershipId,
    onBehalfOf,
    comment: comment ?? ("comment" in action ? (action.comment?.trim() ?? null) : null),
    at,
  };
}

/** 회수: 기안자가, 아무도 처리하기 전(진행 중)에만 할 수 있다 (APV-017) */
export function withdraw(doc: ApprovalDoc, actorId: string, ctx: EngineContext): EngineResult {
  if (actorId !== doc.drafterId) return fail("not_assignee", "기안자만 회수할 수 있습니다");
  if (doc.status !== "IN_PROGRESS")
    return fail("cannot_withdraw", "진행 중인 문서만 회수할 수 있습니다");
  const touched = doc.steps.some(
    (s) =>
      s.type !== "post" &&
      ["APPROVED", "DELEGATED", "REJECTED", "HELD", "SKIPPED"].includes(s.status),
  );
  if (touched) return fail("cannot_withdraw", "이미 처리된 단계가 있어 회수할 수 없습니다");
  const d = new Draft(doc, ctx);
  for (const s of d.doc.steps) {
    if (s.status !== "PENDING") d.setStatus(s, "PENDING");
  }
  d.setDocStatus("WITHDRAWN");
  d.events.push({ type: "withdrawn", docId: doc.id });
  return d.result({
    stepId: doc.steps[0]?.id ?? "",
    action: "withdraw",
    actorId,
    onBehalfOf: null,
    comment: null,
    at: ctx.now,
  });
}

/** 회수한 문서를 초안으로 되돌려 수정할 수 있게 한다 */
export function reopenDraft(doc: ApprovalDoc): EngineResult {
  return transitionDocument(doc, "DRAFT");
}

/** 문서 상태만 바꾸는 전이(취소·보관·재개). 상태도에 없는 전이는 거부한다 */
export function transitionDocument(doc: ApprovalDoc, to: DocStatus): EngineResult {
  if (!canTransition(doc.status, to)) {
    return fail("invalid_state", `${doc.status} 상태에서 ${to}(으)로 바꿀 수 없습니다`);
  }
  return {
    ok: true,
    doc: { ...structuredClone(doc), status: to },
    events: [],
    record: null,
    changedStepIds: [],
  };
}

export type RedraftSeed =
  | { ok: true; draft: ApprovalDoc; supersedes: string }
  | { ok: false; code: EngineErrorCode; message: string };

/** 반려된 문서의 재기안 초안: 결재선 단계를 초기화하고 원문과 연결한다 (APV-019). 본문 복사는 호출 쪽이 한다 */
export function redraftSeed(doc: ApprovalDoc, newStepId: (oldId: string) => string): RedraftSeed {
  if (doc.status !== "REJECTED") {
    return { ok: false, code: "invalid_state", message: "반려된 문서만 재기안할 수 있습니다" };
  }
  const draft: ApprovalDoc = {
    ...structuredClone(doc),
    status: "DRAFT",
    steps: doc.steps.map((s) => ({
      ...structuredClone(s),
      id: newStepId(s.id),
      status: "PENDING",
      version: 0,
      delegates: {},
      heldBy: null,
    })),
  };
  return { ok: true, draft, supersedes: doc.id };
}

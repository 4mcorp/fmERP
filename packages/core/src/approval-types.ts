/** 결재 엔진 공통 타입 (PRD 5.4, GLOSSARY, ADR 0007). 구성원 id는 membership id다. */

export const DOC_STATUSES = [
  "DRAFT",
  "IN_PROGRESS",
  "ON_HOLD",
  "WITHDRAWN",
  "REJECTED",
  "COMPLETED",
  "CANCELED",
  "ARCHIVED",
] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

/** 진행에 관여하는 단계 유형. 참조·수신·공람은 진행에 영향이 없어 엔진 밖(M5)에서 다룬다 */
export const STEP_TYPES = ["approve", "agree", "cooperate", "audit", "post"] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const STEP_STATUSES = [
  "PENDING",
  "ACTIVE",
  "APPROVED",
  "REJECTED",
  "HELD",
  "SKIPPED",
  "DELEGATED",
  "POST_PENDING",
  "POST_APPROVED",
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export interface ApprovalPolicy {
  /** 합의 부동의: 반려로 처리 / 의견만 남기고 진행 */
  disagree: "reject" | "comment";
  /** 반려 대상: 기안자 / 직전 결재 단계 */
  rejectTo: "drafter" | "previous";
  /** 감사 단계에서 반려할 수 있는지. false이면 의견만 남긴다 */
  auditCanReject: boolean;
}

export const DEFAULT_POLICY: ApprovalPolicy = {
  disagree: "reject",
  rejectTo: "drafter",
  auditCanReject: true,
};

export interface ApprovalStep {
  id: string;
  /** 같은 seq의 단계가 한 그룹이다 */
  seq: number;
  type: StepType;
  /** 이 중 1명이 처리한다 (부서 대상은 여러 명) */
  assigneeIds: string[];
  /** 활성화 시점에 정해진 대결자: 처리자 id → 대결자 id */
  delegates: Record<string, string>;
  /** 전결 권한이 있는 단계인지 (결재 단계만) */
  canFinalize: boolean;
  /** 그룹 완료 조건. 그룹의 첫 단계(배열 순서) 값을 쓴다 */
  quorum: "all" | number;
  status: StepStatus;
  /** 낙관적 잠금 (APV-045). 상태가 바뀔 때마다 엔진이 1 올린다 */
  version: number;
  heldBy: string | null;
}

export interface ApprovalDoc {
  id: string;
  status: DocStatus;
  drafterId: string;
  policy: ApprovalPolicy;
  steps: ApprovalStep[];
}

export type ApprovalAction =
  | { kind: "approve" }
  | { kind: "reject"; comment: string }
  | { kind: "hold"; comment?: string }
  | { kind: "release" }
  | { kind: "finalize" }
  | { kind: "agree"; comment?: string }
  | { kind: "disagree"; comment: string }
  | { kind: "audit_approve"; comment?: string }
  | { kind: "audit_reject"; comment: string }
  | { kind: "audit_comment"; comment: string }
  | { kind: "post_approve"; comment?: string };

export interface ApprovalActor {
  membershipId: string;
  /** 결재 관리자 권한 (보류 해제 대행) */
  isApprovalAdmin?: boolean;
}

export type DelegateDecision =
  | { kind: "none" }
  | { kind: "delegate"; delegateId: string }
  /** 대결자도 부재라 연쇄 위임이 금지되어 대결이 성립하지 않음 (APV-053) */
  | { kind: "unavailable"; delegateId: string };

export interface EngineContext {
  now: Date;
  /** 처리자의 대결자를 정한다 (delegation.ts의 decideDelegate를 감싼 함수) */
  decideDelegate: (assigneeId: string) => DelegateDecision;
}

export type ApprovalEvent =
  | { type: "submitted"; docId: string }
  | {
      type: "step_activated";
      docId: string;
      stepId: string;
      assigneeIds: string[];
      delegateIds: string[];
    }
  | {
      type: "delegate_unavailable";
      docId: string;
      stepId: string;
      assigneeId: string;
      delegateId: string;
    }
  | { type: "reactivated"; docId: string; stepId: string }
  | { type: "held"; docId: string; stepId: string }
  | { type: "released"; docId: string; stepId: string }
  | { type: "withdrawn"; docId: string }
  | { type: "rejected"; docId: string; stepId: string; comment: string }
  | { type: "completed"; docId: string }
  | { type: "post_pending"; docId: string; stepId: string; assigneeIds: string[] }
  | { type: "post_approved"; docId: string; stepId: string };

/** 처리 기록(approval_action)에 저장할 내용 (APV-046). IP·기기·멱등 키는 서비스가 붙인다 */
export interface ActionRecord {
  stepId: string;
  action: ApprovalAction["kind"] | "withdraw";
  actorId: string;
  onBehalfOf: string | null;
  comment: string | null;
  at: Date;
}

export type EngineErrorCode =
  | "invalid_state"
  | "step_not_found"
  | "step_not_active"
  | "not_assignee"
  | "action_not_allowed"
  | "comment_required"
  | "version_conflict"
  | "cannot_withdraw"
  | "nothing_to_submit";

export type EngineResult =
  | {
      ok: true;
      doc: ApprovalDoc;
      events: ApprovalEvent[];
      record: ActionRecord | null;
      /** 상태가 바뀐 단계 id (저장 시 낙관적 잠금 대상) */
      changedStepIds: string[];
    }
  | { ok: false; code: EngineErrorCode; message: string };

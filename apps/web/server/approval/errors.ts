import type { EngineErrorCode, LineEditErrorCode } from "@fmerp/core";

export type ApprovalErrorCode =
  | EngineErrorCode
  | LineEditErrorCode
  | "not_found"
  | "forbidden"
  | "line_invalid"
  | "delegation_invalid"
  | "rule_invalid"
  /** 양식 입력값 검증 실패 */
  | "validation_failed"
  /** 상신 이후 본문·첨부가 바뀌었다 (APV-016) */
  | "content_changed"
  /** 다른 저장과 겹쳤다 (본문 리비전 번호 불일치) */
  | "revision_conflict"
  | "attachment_invalid"
  | "form_invalid";

/** 결재 서비스의 업무 오류. 라우트가 RFC 9457 응답으로 바꾼다 (http.ts) */
export class ApprovalError extends Error {
  constructor(
    readonly code: ApprovalErrorCode,
    message: string,
    readonly extensions?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

export const APPROVAL_ERROR_STATUS: Record<ApprovalErrorCode, 400 | 403 | 404 | 409> = {
  invalid_state: 409,
  step_not_found: 404,
  step_not_active: 409,
  not_assignee: 403,
  action_not_allowed: 409,
  comment_required: 400,
  version_conflict: 409,
  cannot_withdraw: 409,
  nothing_to_submit: 400,
  line_edit_not_allowed: 403,
  reason_required: 400,
  invalid_edit: 400,
  not_found: 404,
  forbidden: 403,
  line_invalid: 400,
  delegation_invalid: 400,
  rule_invalid: 400,
  validation_failed: 400,
  content_changed: 409,
  revision_conflict: 409,
  attachment_invalid: 400,
  form_invalid: 400,
};

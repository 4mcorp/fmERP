import type { EngineErrorCode } from "@fmerp/core";

export type ApprovalErrorCode =
  | EngineErrorCode
  | "not_found"
  | "forbidden"
  | "line_invalid"
  | "delegation_invalid"
  | "rule_invalid";

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
  not_found: 404,
  forbidden: 403,
  line_invalid: 400,
  delegation_invalid: 400,
  rule_invalid: 400,
};

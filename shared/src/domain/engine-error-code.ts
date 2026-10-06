/** 결재 엔진·결재선 편집이 돌려주는 오류 코드. 서비스가 이를 HTTP 상태로 바꾸므로(shared/server/errors) 공통 소유다 */
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

export type LineEditErrorCode =
  | "invalid_state"
  | "not_assignee"
  | "reason_required"
  | "line_edit_not_allowed"
  | "invalid_edit";

/** 인증·계정 도메인 오류. API 계층이 RFC 9457 응답으로 바꾼다 (ADR 0003). */
export type AuthErrorCode =
  | "unauthenticated"
  | "idle_expired"
  | "absolute_expired"
  | "no_active_account"
  | "membership_inactive"
  | "invitation_invalid"
  | "already_member"
  | "pin_format"
  | "pin_not_set"
  | "pin_current_required"
  | "pin_mismatch"
  | "pin_locked";

export class AuthDomainError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AuthDomainError";
  }
}

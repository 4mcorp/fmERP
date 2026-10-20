// 사전 등록·등록 토큰의 순수 규칙. 프레임워크·DB·네트워크를 import하지 않는다 (CLAUDE.md 불변 조건).

/** 등록 토큰 기본 유효 시간: 24시간 */
export const ENROLLMENT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export class EnrollmentError extends Error {
  constructor(
    readonly code: "enrollment_email_invalid" | "enrollment_name_invalid" | "enrollment_invalid",
    message: string,
  ) {
    super(message);
    this.name = "EnrollmentError";
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;
const NAME_MAX_LENGTH = 100;

/** 사전 등록 이메일: 공백 제거 후 소문자로 저장한다 */
export function normalizeEnrollmentEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > EMAIL_MAX_LENGTH) {
    throw new EnrollmentError("enrollment_email_invalid", "이메일 형식이 올바르지 않습니다");
  }
  return email;
}

/** 사전 등록 이름: 공백 제거 후 비어 있거나 100자를 넘으면 거부한다 */
export function normalizeEnrollmentName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) {
    throw new EnrollmentError("enrollment_name_invalid", "이름은 1~100자로 입력하세요");
  }
  return name;
}

export type EnrollmentTokenState = "usable" | "expired" | "used" | "revoked";

/**
 * 등록 토큰 상태. 사용·폐기가 만료보다 우선한다.
 * 만료 시각과 같은 순간도 만료로 본다.
 */
export function enrollmentTokenState(
  token: { expiresAt: Date; usedAt: Date | null; revokedAt: Date | null },
  now: Date,
): EnrollmentTokenState {
  if (token.usedAt) return "used";
  if (token.revokedAt) return "revoked";
  if (token.expiresAt.getTime() <= now.getTime()) return "expired";
  return "usable";
}

/** 발급 시각 기준 만료 시각 */
export function enrollmentExpiresAt(now: Date, ttlMs: number = ENROLLMENT_TOKEN_TTL_MS): Date {
  return new Date(now.getTime() + ttlMs);
}

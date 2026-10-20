import { describe, expect, it } from "vitest";
import {
  ENROLLMENT_TOKEN_TTL_MS,
  EnrollmentError,
  enrollmentExpiresAt,
  enrollmentTokenState,
  normalizeEnrollmentEmail,
  normalizeEnrollmentName,
} from "../src/domain/enrollment";

const NOW = new Date("2026-10-20T00:00:00.000Z");
const FUTURE = new Date(NOW.getTime() + 60_000);
const PAST = new Date(NOW.getTime() - 60_000);

describe("사전 등록 이메일·이름 정규화", () => {
  it("이메일은 앞뒤 공백을 지우고 소문자로 바꾼다", () => {
    expect(normalizeEnrollmentEmail("  Kim@Example.COM ")).toBe("kim@example.com");
  });

  it("형식이 맞지 않는 이메일은 거부한다", () => {
    for (const bad of ["", "   ", "no-at-sign", "a@", "@b.com", "a b@c.com"]) {
      expect(() => normalizeEnrollmentEmail(bad)).toThrow(EnrollmentError);
    }
  });

  it("이메일은 254자까지 받고 255자를 넘으면 거부한다", () => {
    const max = `${"a".repeat(254 - "@x.com".length)}@x.com`;
    expect(max.length).toBe(254);
    expect(normalizeEnrollmentEmail(max)).toBe(max);
    const tooLong = `${"a".repeat(255 - "@x.com".length)}@x.com`;
    expect(tooLong.length).toBe(255);
    expect(() => normalizeEnrollmentEmail(tooLong)).toThrow(EnrollmentError);
  });

  it("이름은 앞뒤 공백을 지우고, 비었거나 100자를 넘으면 거부한다", () => {
    expect(normalizeEnrollmentName(" 김철수 ")).toBe("김철수");
    expect(() => normalizeEnrollmentName("  ")).toThrow(EnrollmentError);
    expect(() => normalizeEnrollmentName("가".repeat(101))).toThrow(EnrollmentError);
  });
});

describe("등록 토큰 상태", () => {
  it("만료 전이고 쓰지도 폐기하지도 않았으면 사용 가능", () => {
    expect(enrollmentTokenState({ expiresAt: FUTURE, usedAt: null, revokedAt: null }, NOW)).toBe(
      "usable",
    );
  });

  it("만료 시각과 같거나 지났으면 expired", () => {
    expect(enrollmentTokenState({ expiresAt: NOW, usedAt: null, revokedAt: null }, NOW)).toBe(
      "expired",
    );
    expect(enrollmentTokenState({ expiresAt: PAST, usedAt: null, revokedAt: null }, NOW)).toBe(
      "expired",
    );
  });

  it("사용 시각이 있으면 used, 재발급으로 폐기되었으면 revoked. 둘 다 만료보다 우선", () => {
    expect(enrollmentTokenState({ expiresAt: FUTURE, usedAt: PAST, revokedAt: null }, NOW)).toBe(
      "used",
    );
    expect(enrollmentTokenState({ expiresAt: PAST, usedAt: PAST, revokedAt: null }, NOW)).toBe(
      "used",
    );
    expect(enrollmentTokenState({ expiresAt: FUTURE, usedAt: null, revokedAt: PAST }, NOW)).toBe(
      "revoked",
    );
  });
});

describe("등록 토큰 만료 시각", () => {
  it("기본은 발급 시각부터 24시간", () => {
    expect(ENROLLMENT_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(enrollmentExpiresAt(NOW).getTime()).toBe(NOW.getTime() + ENROLLMENT_TOKEN_TTL_MS);
  });

  it("지정한 유효 시간을 쓴다", () => {
    expect(enrollmentExpiresAt(NOW, 1000).getTime()).toBe(NOW.getTime() + 1000);
  });
});

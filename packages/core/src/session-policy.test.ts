import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_POLICY,
  evaluateSession,
  resolveSessionPolicy,
  shouldTouchSession,
} from "./session-policy";

const t0 = new Date("2026-10-03T09:00:00+09:00");
const minutes = (n: number) => new Date(t0.getTime() + n * 60_000);

describe("resolveSessionPolicy", () => {
  it("계정 정책이 없으면 기본값(유휴 2시간, 절대 12시간)", () => {
    expect(resolveSessionPolicy()).toEqual({ idleTimeoutMinutes: 120, absoluteTimeoutHours: 12 });
    expect(resolveSessionPolicy({})).toEqual(DEFAULT_SESSION_POLICY);
  });

  it("계정 정책이 있으면 그 값이 우선한다", () => {
    expect(resolveSessionPolicy({ idleTimeoutMinutes: 30 })).toEqual({
      idleTimeoutMinutes: 30,
      absoluteTimeoutHours: 12,
    });
  });
});

describe("evaluateSession", () => {
  const policy = DEFAULT_SESSION_POLICY;

  it("마지막 활동 후 2시간 안이면 유효", () => {
    expect(
      evaluateSession({ createdAt: t0, lastActiveAt: minutes(60), now: minutes(179) }, policy),
    ).toBe("active");
  });

  it("마지막 활동 후 2시간이 지나면 유휴 만료", () => {
    expect(evaluateSession({ createdAt: t0, lastActiveAt: t0, now: minutes(120) }, policy)).toBe(
      "idle_expired",
    );
  });

  it("계속 활동해도 생성 후 12시간이 지나면 절대 만료", () => {
    expect(
      evaluateSession({ createdAt: t0, lastActiveAt: minutes(719), now: minutes(720) }, policy),
    ).toBe("absolute_expired");
  });

  it("계정의 더 짧은 유휴 정책이 적용된다", () => {
    const strict = resolveSessionPolicy({ idleTimeoutMinutes: 30 });
    expect(evaluateSession({ createdAt: t0, lastActiveAt: t0, now: minutes(31) }, strict)).toBe(
      "idle_expired",
    );
  });
});

describe("shouldTouchSession", () => {
  it("마지막 갱신 후 1분이 지났을 때만 활동 시각을 갱신한다 (DB 쓰기 줄이기)", () => {
    expect(shouldTouchSession(t0, minutes(0.5))).toBe(false);
    expect(shouldTouchSession(t0, minutes(1))).toBe(true);
  });
});

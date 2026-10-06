import { describe, expect, it } from "vitest";
import { isPinFormatValid, isPinReauthFresh, pinLockState, recordPinFailure } from "./pin-policy";

const t0 = new Date("2026-10-03T09:00:00+09:00");
const minutes = (n: number) => new Date(t0.getTime() + n * 60_000);

describe("PIN 형식", () => {
  it("숫자 6~12자리만 허용한다", () => {
    expect(isPinFormatValid("123456")).toBe(true);
    expect(isPinFormatValid("123456789012")).toBe(true);
    expect(isPinFormatValid("12345")).toBe(false);
    expect(isPinFormatValid("12345a")).toBe(false);
    expect(isPinFormatValid("1234567890123")).toBe(false);
  });
});

describe("PIN 실패와 잠금 (PRD AUTH-009)", () => {
  it("4번째 실패까지는 잠기지 않는다", () => {
    let state = { failedCount: 0, lockedUntil: null as Date | null };
    for (let i = 0; i < 4; i++) state = recordPinFailure(state, t0);
    expect(state.failedCount).toBe(4);
    expect(pinLockState(state, t0).locked).toBe(false);
  });

  it("5번째 실패에서 15분 잠기고 실패 횟수를 초기화한다", () => {
    const state = recordPinFailure({ failedCount: 4, lockedUntil: null }, t0);
    expect(state).toEqual({ failedCount: 0, lockedUntil: minutes(15) });
    expect(pinLockState(state, minutes(14))).toEqual({ locked: true, remainingSeconds: 60 });
  });

  it("15분이 지나면 잠금이 풀린다", () => {
    const state = { failedCount: 0, lockedUntil: minutes(15) };
    expect(pinLockState(state, minutes(15)).locked).toBe(false);
  });
});

describe("PIN 재인증 유효 시간", () => {
  it("검증 후 30분 동안은 다시 묻지 않는다", () => {
    expect(isPinReauthFresh(t0, minutes(29))).toBe(true);
    expect(isPinReauthFresh(t0, minutes(30))).toBe(false);
    expect(isPinReauthFresh(null, t0)).toBe(false);
  });
});

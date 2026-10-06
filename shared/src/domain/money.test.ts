import { describe, expect, it } from "vitest";
import { toWon } from "./money";

describe("toWon", () => {
  it("안전한 정수는 그대로 원 금액이 된다", () => {
    expect(toWon(15_000_000)).toBe(15_000_000);
    expect(toWon(-3_000)).toBe(-3_000);
  });

  it("소수점 금액은 거부한다", () => {
    expect(() => toWon(1000.5)).toThrow(RangeError);
  });

  it("안전한 정수 범위를 넘는 금액은 거부한다", () => {
    expect(() => toWon(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

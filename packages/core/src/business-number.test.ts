import { describe, expect, it } from "vitest";
import {
  isValidBusinessNumber,
  makeBusinessNumber,
  normalizeBusinessNumber,
} from "./business-number";

describe("사업자등록번호 (PRD ORG-003)", () => {
  it("하이픈과 공백을 제거해 10자리로 정규화한다", () => {
    expect(normalizeBusinessNumber("220-81-62517")).toBe("2208162517");
    expect(normalizeBusinessNumber(" 220 81 62517 ")).toBe("2208162517");
  });

  it("알려진 유효 번호는 통과한다", () => {
    expect(isValidBusinessNumber("220-81-62517")).toBe(true);
    expect(isValidBusinessNumber("1208800767")).toBe(true);
  });

  it("체크섬이 틀리면 거부한다 (S1)", () => {
    expect(isValidBusinessNumber("220-81-62518")).toBe(false);
    expect(isValidBusinessNumber("1208800768")).toBe(false);
  });

  it("자릿수가 10이 아니거나 숫자가 아니면 거부한다", () => {
    expect(isValidBusinessNumber("123456789")).toBe(false);
    expect(isValidBusinessNumber("12345678901")).toBe(false);
    expect(isValidBusinessNumber("22081625ab")).toBe(false);
  });

  it("앞 9자리로 유효한 번호를 만든다 (시드·테스트용)", () => {
    const made = makeBusinessNumber("123456789");
    expect(made).toHaveLength(10);
    expect(isValidBusinessNumber(made)).toBe(true);
  });
});

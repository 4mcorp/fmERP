import { describe, expect, it } from "vitest";
import { type DelegationRule, decideDelegate, validateDelegation } from "./delegation";

const d = (s: string) => new Date(`${s}T00:00:00+09:00`);
const rule = (over: Partial<DelegationRule> = {}): DelegationRule => ({
  membershipId: "a",
  delegateId: "b",
  from: d("2026-10-01"),
  to: d("2026-10-10"),
  scope: { kind: "all" },
  ...over,
});
const at = (day: string, category?: string) => ({ now: d(day), category });

describe("대결자 결정 (APV-050·051)", () => {
  it("부재 기간 안이면 대결자를 돌려주고, 밖이면 없음", () => {
    expect(decideDelegate("a", [rule()], at("2026-10-05"))).toEqual({
      kind: "delegate",
      delegateId: "b",
    });
    expect(decideDelegate("a", [rule()], at("2026-09-30"))).toEqual({ kind: "none" });
    expect(decideDelegate("a", [rule()], at("2026-10-11"))).toEqual({ kind: "none" });
    expect(decideDelegate("x", [rule()], at("2026-10-05"))).toEqual({ kind: "none" });
  });

  it("적용 범위: 전체 또는 특정 양식 분류", () => {
    const scoped = rule({ scope: { kind: "category", categories: ["지출"] } });
    expect(decideDelegate("a", [scoped], at("2026-10-05", "지출"))).toMatchObject({
      kind: "delegate",
    });
    expect(decideDelegate("a", [scoped], at("2026-10-05", "휴가"))).toEqual({ kind: "none" });
    expect(decideDelegate("a", [scoped], at("2026-10-05"))).toEqual({ kind: "none" });
  });

  it("대결자도 같은 기간 부재이면 연쇄 위임 금지로 unavailable (APV-053)", () => {
    const chain = rule({ membershipId: "b", delegateId: "c" });
    expect(decideDelegate("a", [rule(), chain], at("2026-10-05"))).toEqual({
      kind: "unavailable",
      delegateId: "b",
    });
    // 대결자의 부재 범위가 다른 분류이면 영향 없음
    const other = rule({
      membershipId: "b",
      delegateId: "c",
      scope: { kind: "category", categories: ["휴가"] },
    });
    expect(decideDelegate("a", [rule(), other], at("2026-10-05", "지출"))).toMatchObject({
      kind: "delegate",
    });
  });
});

describe("부재 설정 검증 (APV-050·053)", () => {
  it("정상 설정은 통과한다", () => {
    expect(validateDelegation(rule(), [])).toEqual({ ok: true });
  });

  it("본인 위임, 기간 역전은 거부", () => {
    expect(validateDelegation(rule({ delegateId: "a" }), []).ok).toBe(false);
    expect(validateDelegation(rule({ from: d("2026-10-10"), to: d("2026-10-01") }), []).ok).toBe(
      false,
    );
  });

  it("같은 사람의 겹치는 부재 설정은 거부 (범위가 겹칠 때만)", () => {
    expect(validateDelegation(rule(), [rule({ delegateId: "z" })]).ok).toBe(false);
    const other = rule({ scope: { kind: "category", categories: ["휴가"] } });
    const mine = rule({ scope: { kind: "category", categories: ["지출"] } });
    expect(validateDelegation(mine, [other])).toEqual({ ok: true });
    expect(validateDelegation(rule(), [other]).ok).toBe(false); // 전체와 분류는 겹친다
  });

  it("대결자가 같은 기간 부재이거나, 나에게 위임한 사람이 있으면 연쇄 위임으로 거부", () => {
    const bAway = rule({ membershipId: "b", delegateId: "c" });
    expect(validateDelegation(rule(), [bAway])).toMatchObject({ ok: false });
    const cDelegatesToA = rule({ membershipId: "c", delegateId: "a" });
    expect(validateDelegation(rule(), [cDelegatesToA])).toMatchObject({ ok: false });
    // 기간이 겹치지 않으면 허용
    const later = rule({
      membershipId: "b",
      delegateId: "c",
      from: d("2026-11-01"),
      to: d("2026-11-05"),
    });
    expect(validateDelegation(rule(), [later])).toEqual({ ok: true });
  });
});

import { describe, expect, it } from "vitest";
import { evaluate, limitRegressions, normalize } from "../ratchet";

describe("래칫 평가", () => {
  const base = ["a -> b", "c -> d"];

  it("기준선과 같고 한도 안이면 통과한다", () => {
    expect(evaluate("g", base, ["a -> b", "c -> d"], 2).errors).toEqual([]);
  });

  it("새 위반이 생기면 실패한다 (기준선에 슬쩍 넣을 수 없다)", () => {
    const r = evaluate("g", base, ["a -> b", "c -> d", "x -> y"], 3);
    expect(r.added).toEqual(["x -> y"]);
    expect(r.errors.join()).toContain("새 위반");
  });

  it("위반이 줄었는데 기준선을 안 줄이면 실패한다 (남은 여유분이 새 위반을 숨기지 못하게)", () => {
    const r = evaluate("g", base, ["a -> b"], 2);
    expect(r.removed).toEqual(["c -> d"]);
    expect(r.errors.join()).toContain("기준선을 커밋");
  });

  it("한도를 넘으면 실패하고, 한도가 없어도 실패한다", () => {
    expect(evaluate("g", base, base, 1).errors.join()).toContain("한도 1건을 넘었습니다");
    expect(evaluate("g", base, base, undefined).errors.join()).toContain("한도가 없습니다");
  });

  it("키는 정렬·중복 제거된다", () => {
    expect(normalize(["b", "a", "b"])).toEqual(["a", "b"]);
  });
});

describe("규칙 약화 감지", () => {
  it("한도가 늘었거나 게이트가 사라지면 문제로 본다", () => {
    expect(limitRegressions({ a: 5, b: 3 }, { a: 5, b: 3 })).toEqual([]);
    expect(limitRegressions({ a: 5, b: 3 }, { a: 4, b: 3 })).toEqual([]);
    expect(limitRegressions({ a: 5 }, { a: 6 }).join()).toContain("5 → 6");
    expect(limitRegressions({ a: 5, b: 3 }, { a: 5 }).join()).toContain("b:");
  });

  it("새 게이트 추가는 허용한다", () => {
    expect(limitRegressions({ a: 5 }, { a: 5, z: 100 })).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { CARD_GRID_CLASS, CARD_GRID_FULL_CLASS, CardGrid } from "./card-grid";

describe("CardGrid", () => {
  it("열 수는 기본 1, md 2, xl 3, 2xl 4, 1920px 이상 5(최대)", () => {
    const cls = CARD_GRID_CLASS.split(" ");
    expect(cls).toContain("grid-cols-1");
    expect(cls).toContain("md:grid-cols-2");
    expect(cls).toContain("xl:grid-cols-3");
    expect(cls).toContain("2xl:grid-cols-4");
    expect(cls).toContain("min-[1920px]:grid-cols-5");
    expect(cls.some((c) => c.includes("grid-cols-6"))).toBe(false);
  });
  it("Full 래퍼는 한 행 전체를 차지한다", () => {
    expect(CARD_GRID_FULL_CLASS).toBe("col-span-full");
    expect(CardGrid.Full).toBeTypeOf("function");
  });
});

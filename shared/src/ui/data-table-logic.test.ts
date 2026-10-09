import { describe, expect, it } from "vitest";
import {
  clampPage,
  matchesSearch,
  nextSort,
  pageCount,
  pruneSelection,
  slicePage,
  sortRows,
} from "./data-table-logic";

describe("nextSort", () => {
  it("없음 → 오름 → 내림 → 없음으로 순환한다", () => {
    const a = nextSort(null, "x");
    expect(a).toEqual({ id: "x", dir: "asc" });
    const b = nextSort(a, "x");
    expect(b).toEqual({ id: "x", dir: "desc" });
    expect(nextSort(b, "x")).toBeNull();
  });
  it("다른 열을 누르면 그 열의 오름차순으로 시작한다", () => {
    expect(nextSort({ id: "x", dir: "desc" }, "y")).toEqual({ id: "y", dir: "asc" });
  });
});

describe("sortRows", () => {
  const rows = [{ v: 2 }, { v: null }, { v: 1 }, { v: 3 }];
  it("오름차순에서 null은 끝", () => {
    expect(sortRows(rows, (r) => r.v, "asc").map((r) => r.v)).toEqual([1, 2, 3, null]);
  });
  it("내림차순에서도 null은 끝", () => {
    expect(sortRows(rows, (r) => r.v, "desc").map((r) => r.v)).toEqual([3, 2, 1, null]);
  });
  it("같은 값은 원래 순서를 유지한다", () => {
    const r = [
      { k: "a", v: 1 },
      { k: "b", v: 1 },
    ];
    expect(sortRows(r, (x) => x.v, "desc").map((x) => x.k)).toEqual(["a", "b"]);
  });
  it("문자열은 한국어 순서로 비교하고 원본을 바꾸지 않는다", () => {
    const r = [{ s: "다" }, { s: "가" }, { s: "나" }];
    expect(sortRows(r, (x) => x.s, "asc").map((x) => x.s)).toEqual(["가", "나", "다"]);
    expect(r[0]?.s).toBe("다");
  });
});

describe("matchesSearch", () => {
  it("대소문자를 무시한 부분 일치", () => {
    expect(matchesSearch("Hello World", "lo wo")).toBe(true);
    expect(matchesSearch("Hello", "xyz")).toBe(false);
  });
  it("빈 검색어는 통과", () => {
    expect(matchesSearch("a", "  ")).toBe(true);
  });
});

describe("페이지", () => {
  it("pageCount는 최소 1", () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(41, 20)).toBe(3);
  });
  it("clampPage는 범위를 맞춘다", () => {
    expect(clampPage(9, 41, 20)).toBe(3);
    expect(clampPage(0, 41, 20)).toBe(1);
  });
  it("slicePage는 해당 페이지만 자른다", () => {
    const rows = Array.from({ length: 25 }, (_, i) => i);
    expect(slicePage(rows, 2, 10)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(slicePage(rows, 3, 10)).toHaveLength(5);
    expect(slicePage(rows, 99, 10)).toHaveLength(5);
  });
});

describe("pruneSelection", () => {
  it("없어진 키만 제거한다", () => {
    const next = pruneSelection(new Set(["a", "b"]), new Set(["b", "c"]));
    expect([...next]).toEqual(["b"]);
  });
  it("변화가 없으면 같은 Set을 돌려준다", () => {
    const s = new Set(["a"]);
    expect(pruneSelection(s, new Set(["a", "b"]))).toBe(s);
  });
});

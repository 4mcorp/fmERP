import { describe, expect, it } from "vitest";
import { collapsibleBodyClass } from "./collapsible-card";

describe("collapsibleBodyClass", () => {
  it("펼친 본문은 숨김 클래스가 없다", () => {
    expect(collapsibleBodyClass(true)).toBe("");
  });
  it("접힌 본문은 화면에서 숨기되 인쇄에서는 항상 펼친다", () => {
    const cls = collapsibleBodyClass(false);
    expect(cls).toContain("hidden");
    expect(cls).toContain("print:block");
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants } from "./tabs";

afterEach(() => cleanup());

describe("TabsList variant (R14 탭 표준)", () => {
  it("기본 variant는 배경이 있는 default이다", () => {
    const cls = tabsListVariants({}).split(" ");
    expect(cls).toContain("bg-muted");
    expect(cls).not.toContain("bg-transparent");
  });

  it("line variant는 배경을 투명하게 하고 밑줄형 표시를 쓴다", () => {
    const cls = tabsListVariants({ variant: "line" }).split(" ");
    expect(cls).toContain("bg-transparent");
    expect(cls).toContain("gap-1");
    expect(cls).not.toContain("bg-muted");
  });

  it("line variant 탭을 누르면 선택 상태(aria-selected)가 바뀐다", () => {
    const { getByRole, container } = render(
      createElement(
        Tabs,
        { defaultValue: "mine" },
        createElement(
          TabsList,
          { variant: "line" },
          createElement(TabsTrigger, { value: "mine" }, "내 문서"),
          createElement(TabsTrigger, { value: "all" }, "전체"),
        ),
        createElement(TabsContent, { value: "mine" }, "내 문서 목록"),
        createElement(TabsContent, { value: "all" }, "전체 목록"),
      ),
    );
    const list = container.querySelector('[data-slot="tabs-list"]');
    expect(list?.getAttribute("data-variant")).toBe("line");

    const mine = getByRole("tab", { name: "내 문서" });
    const all = getByRole("tab", { name: "전체" });
    expect(mine.getAttribute("aria-selected")).toBe("true");
    expect(all.getAttribute("aria-selected")).toBe("false");

    fireEvent.mouseDown(all, { button: 0, ctrlKey: false });
    expect(all.getAttribute("aria-selected")).toBe("true");
    expect(mine.getAttribute("aria-selected")).toBe("false");
  });
});

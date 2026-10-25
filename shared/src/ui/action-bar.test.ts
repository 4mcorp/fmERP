// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ActionBar } from "./action-bar";
import { Button } from "./button";

type BarElement = {
  props: { "data-slot"?: string; className?: string; children?: unknown };
};

afterEach(() => cleanup());

describe("ActionBar (R13 페이지 action 줄)", () => {
  it("오른쪽 정렬 줄이며 data-slot을 단다", () => {
    const el = ActionBar({ children: "x" }) as unknown as BarElement;
    expect(el.props["data-slot"]).toBe("action-bar");
    const cls = (el.props.className ?? "").split(" ");
    expect(cls).toContain("justify-end");
    expect(cls).toContain("flex-wrap");
    expect(cls).toContain("gap-2");
  });

  it("호출자 className을 기본 클래스 뒤에 덧붙인다", () => {
    const el = ActionBar({ className: "sticky bottom-0", children: "x" }) as unknown as BarElement;
    const cls = (el.props.className ?? "").split(" ");
    expect(cls).toContain("justify-end");
    expect(cls).toContain("sticky");
    expect(cls).toContain("bottom-0");
  });

  it("자식 순서를 그대로 유지한다(보조 → 주 동작 순서가 DOM 순서가 된다)", () => {
    const el = ActionBar({ children: ["취소", "저장"] }) as unknown as BarElement;
    expect(el.props.children).toEqual(["취소", "저장"]);
  });

  it("DOM에서 보조 버튼이 왼쪽, 주 버튼(default)이 맨 오른쪽에 온다", () => {
    const { container, getByRole } = render(
      createElement(
        ActionBar,
        null,
        createElement(Button, { type: "button", variant: "outline" }, "취소"),
        createElement(Button, { type: "button", variant: "default" }, "상신"),
      ),
    );
    const bar = container.querySelector('[data-slot="action-bar"]');
    expect(bar).not.toBeNull();
    const buttons = Array.from(bar?.querySelectorAll("button") ?? []);
    expect(buttons.map((b) => b.textContent)).toEqual(["취소", "상신"]);
    expect(buttons[0]?.getAttribute("data-variant")).toBe("outline");
    expect(buttons[1]?.getAttribute("data-variant")).toBe("default");
    expect(getByRole("button", { name: "상신" })).toBe(buttons[1]);
  });
});

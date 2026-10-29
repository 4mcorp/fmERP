// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { type ComponentProps, createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CollapsibleCard, collapsibleBodyClass } from "./collapsible-card";

afterEach(() => cleanup());

type CardProps = ComponentProps<typeof CollapsibleCard>;

/** children을 객체 리터럴 키로 쓰지 않도록 props를 타입 있는 변수로 만든다 */
function cardProps(title: string, children: ComponentProps<"span">["children"]): CardProps {
  const props: CardProps = { title, children };
  return props;
}

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

describe("CollapsibleCard 토글 상호작용", () => {
  it("머리줄 버튼으로 열고 닫히며 aria-expanded와 data-state가 따라간다", () => {
    const { getByRole, container } = render(
      createElement(
        CollapsibleCard,
        cardProps("의견", createElement("input", { "aria-label": "의견 입력" })),
      ),
    );
    const toggle = getByRole("button", { name: /의견/ });
    const section = container.querySelector('[data-slot="collapsible-card"]');
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(section?.getAttribute("data-state")).toBe("closed");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(section?.getAttribute("data-state")).toBe("open");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(section?.getAttribute("data-state")).toBe("closed");
  });

  it("접힌 본문은 숨김 클래스를 가지며, 안의 입력 요소는 접근 가능한 이름으로 DOM에 남는다", () => {
    const { getByRole, getByLabelText } = render(
      createElement(
        CollapsibleCard,
        cardProps("의견", createElement("input", { "aria-label": "의견 입력" })),
      ),
    );
    const toggle = getByRole("button", { name: /의견/ });
    const bodyId = toggle.getAttribute("aria-controls") ?? "";
    expect(bodyId).not.toBe("");
    const body = document.getElementById(bodyId);
    expect(body).not.toBeNull();
    expect(body?.className).toContain("hidden");
    expect(getByLabelText("의견 입력")).toBeTruthy();
  });

  it("버튼을 열면 본문의 숨김 클래스가 사라진다", () => {
    const { getByRole } = render(
      createElement(CollapsibleCard, cardProps("공람", createElement("span", null, "본문"))),
    );
    const toggle = getByRole("button", { name: /공람/ });
    fireEvent.click(toggle);
    const body = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(body?.className).not.toContain("hidden");
  });
});

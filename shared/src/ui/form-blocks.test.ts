// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FormBlocks } from "./form-blocks";

afterEach(cleanup);

describe("FormBlocks 웹 어댑터", () => {
  it("입력 라벨 어댑터가 공통 라벨 틀 안에서 컨트롤과 연결된다", () => {
    const { container } = render(
      createElement(FormBlocks, {
        mode: "fill",
        schema: { fields: [{ key: "memo", type: "text", label: "메모", required: true }] },
        layout: {},
        renderLabel: (field) => createElement("label", { htmlFor: field.key }, field.label),
        renderField: (field) => createElement("input", { id: field.key }),
      }),
    );
    expect(screen.getByRole("textbox", { name: "메모" })).toBeTruthy();
    expect(container.querySelectorAll(".field > .label")).toHaveLength(1);
    expect(container.querySelector(".legacy-fields")).not.toBeNull();
  });

  it("네 모드에서 같은 트리와 이스케이프된 설명을 그린다", () => {
    for (const mode of ["edit", "fill", "view", "print"] as const) {
      const { container, unmount } = render(
        createElement(FormBlocks, {
          mode,
          schema: { fields: [{ key: "memo", type: "text", label: "메모" }] },
          layout: {
            blocks: [
              { kind: "text", text: "<script>위험</script>" },
              { kind: "field", key: "memo" },
            ],
          },
          renderField: (field, context) =>
            createElement("input", { "aria-label": field.label, readOnly: !context.canEditValues }),
        }),
      );
      expect(container.querySelector(".form-blocks")?.getAttribute("data-mode")).toBe(mode);
      expect(container.querySelector("script")).toBeNull();
      expect(screen.getByText("<script>위험</script>")).toBeTruthy();
      expect((screen.getByRole("textbox", { name: "메모" }) as HTMLInputElement).readOnly).toBe(
        mode !== "fill",
      );
      unmount();
    }
  });
});

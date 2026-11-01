// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FormBlocks } from "./form-blocks";

afterEach(cleanup);

describe("FormBlocks 웹 어댑터", () => {
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

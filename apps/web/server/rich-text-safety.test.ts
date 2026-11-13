import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  RichTextEditor,
  RichTextView,
} from "../../../features/approval/src/ui/components/rich-text";

describe("저장된 리치 텍스트의 안전한 열기", () => {
  it("위험한 표를 편집기와 읽기 화면에서 거부하고 변경 콜백을 호출하지 않는다", () => {
    const value = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 1000000 },
                  content: [{ type: "paragraph" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const onChange = vi.fn();
    expect(
      renderToStaticMarkup(createElement(RichTextEditor, { id: "body", value, onChange })),
    ).toContain("안전하지 않은 본문");
    expect(renderToStaticMarkup(createElement(RichTextView, { value }))).toContain(
      "안전하지 않은 본문",
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});

it("깊은 이전 본문을 손실 없이 읽기 전용으로 연다", () => {
  type LegacyNode = { type: string; content?: LegacyNode[]; text?: string };
  let node: LegacyNode = {
    type: "paragraph",
    content: [{ type: "text", text: "깊은 기존 본문" }],
  };
  for (let i = 0; i < 600; i++) node = { type: "blockquote", content: [node] };
  const value = { type: "doc", content: [node] };
  const onChange = vi.fn();
  const html = renderToStaticMarkup(createElement(RichTextEditor, { id: "body", value, onChange }));
  expect(html).toContain("깊은 기존 본문");
  expect(html).toContain("편집할 수 없습니다");
  expect(onChange).not.toHaveBeenCalled();
});

it("지원하지 않는 기존 본문의 전체 텍스트를 안전하게 표시하고 편집하지 않는다", () => {
  const value = {
    type: "doc",
    content: [{ type: "legacyWidget", content: [{ type: "text", text: "<기존 원문>" }] }],
  };
  const onChange = vi.fn();
  for (const element of [
    createElement(RichTextEditor, { id: "body", value, onChange }),
    createElement(RichTextView, { value }),
  ]) {
    const html = renderToStaticMarkup(element);
    expect(html).toContain("&lt;기존 원문&gt;");
    expect(html).toContain("편집할 수 없습니다");
  }
  expect(onChange).not.toHaveBeenCalled();
});

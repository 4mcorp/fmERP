import { describe, expect, it } from "vitest";
import { legacyRichText } from "./rich-text-fallback";

describe("legacy rich text fallback", () => {
  it("preserves text in unsupported and deeply nested documents", () => {
    let node: { type: string; content: unknown[] } = {
      type: "unsupported",
      content: [{ type: "text", text: "<원문>" }],
    };
    for (let i = 0; i < 300; i++) node = { type: "blockquote", content: [node] };
    expect(legacyRichText({ type: "doc", content: [node] })).toBe("<원문>");
  });
  it("rejects cycles rather than looping", () => {
    const doc: { type: string; content: unknown[] } = { type: "doc", content: [] };
    doc.content.push(doc);
    expect(legacyRichText(doc)).toBeNull();
  });
});

it("문단과 목록 항목을 줄바꿈으로 구분한다", () => {
  const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  expect(
    legacyRichText({
      type: "doc",
      content: [
        paragraph("A"),
        paragraph("B"),
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [paragraph("C")] },
            { type: "listItem", content: [paragraph("D")] },
          ],
        },
      ],
    }),
  ).toBe("A\nB\nC\nD");
});

import { isSafeRichText } from "@fmerp/shared/domain/rich-text-safety";
import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { richTextExtensions } from "./rich-text-schema";

describe("리치 텍스트 문서", () => {
  it("기본 3x3 표의 공유 기본 속성을 안전한 본문으로 허용한다", () => {
    const schema = getSchema(richTextExtensions);
    const { tableHeader, tableRow, table, doc: docType } = schema.nodes;
    if (!tableHeader || !tableRow || !table || !docType) throw new Error("table schema missing");
    const cells = Array.from({ length: 3 }, () => {
      const cell = tableHeader.createAndFill();
      if (!cell) throw new Error("table cell creation failed");
      return cell;
    });
    const rows = Array.from({ length: 3 }, () => tableRow.create(null, cells));
    const doc = docType.create(null, table.create(null, rows));
    expect(isSafeRichText(doc.toJSON())).toBe(true);
  });
  it("rowspan이 겹쳐 실제 표 폭이 커지는 공격을 거부한다", () => {
    const rows = Array.from({ length: 100 }, () => ({
      type: "tableRow",
      content: [{ type: "tableCell", attrs: { colspan: 100, rowspan: 100 } }],
    }));
    expect(isSafeRichText({ type: "doc", content: [{ type: "table", content: rows }] })).toBe(
      false,
    );
  });
  it("기존 제목과 목록 JSON을 표 확장 추가 후에도 읽는다", () => {
    const schema = getSchema(richTextExtensions);
    const old = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "기존 제목" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "기존 항목" }] }],
            },
          ],
        },
      ],
    };
    const doc = schema.nodeFromJSON(old);
    doc.check();
    expect(doc.textContent).toBe("기존 제목기존 항목");
  });
  it("표와 제목을 JSON으로 보존하고 다시 읽는다", () => {
    const schema = getSchema(richTextExtensions);
    const json = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "제목" }] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "항목" }] }],
                },
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "값" }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const restored = schema.nodeFromJSON(json);
    restored.check();
    expect(
      restored
        .toJSON()
        .content?.[1]?.content?.[0]?.content?.map((node: { type: string }) => node.type),
    ).toEqual(["tableHeader", "tableCell"]);
    expect(restored.textContent).toBe("제목항목값");
  });
});

it("기존 35단 인용문을 편집기 스키마에서 보존한다", () => {
  let node: { type: string; content: unknown[] } = {
    type: "paragraph",
    content: [{ type: "text", text: "기존 본문" }],
  };
  for (let i = 0; i < 35; i++) node = { type: "blockquote", content: [node] };
  const json = { type: "doc", content: [node] };
  expect(isSafeRichText(json)).toBe(true);
  const doc = getSchema(richTextExtensions).nodeFromJSON(json);
  doc.check();
  expect(doc.textContent).toBe("기존 본문");
});

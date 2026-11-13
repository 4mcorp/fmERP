import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it, vi } from "vitest";
import { handleRichTextPaste, richTextGuard } from "./rich-text-guard";
import { richTextExtensions } from "./rich-text-schema";

describe("리치텍스트 입력 보호", () => {
  it("HTML을 파싱하지 않고 클립보드의 일반 텍스트를 삽입한다", () => {
    const insertText = vi.fn().mockReturnThis();
    const scrollIntoView = vi.fn().mockReturnThis();
    const dispatch = vi.fn();
    const preventDefault = vi.fn();
    const event = {
      clipboardData: {
        getData: (type: string) =>
          type === "text/plain" ? "안전한 텍스트" : "<table><td colspan=999999>",
      },
      preventDefault,
    };
    handleRichTextPaste(
      { state: { tr: { insertText, scrollIntoView } }, dispatch } as never,
      event as never,
    );
    expect(preventDefault).toHaveBeenCalled();
    expect(insertText).toHaveBeenCalledWith("안전한 텍스트");
    expect(dispatch).toHaveBeenCalled();
  });
  it("큰 일반 텍스트 또는 텍스트 없는 클립보드는 삽입하지 않는다", () => {
    const dispatch = vi.fn();
    for (const text of ["x".repeat(100001), ""]) {
      const preventDefault = vi.fn();
      handleRichTextPaste(
        { dispatch } as never,
        {
          clipboardData: { getData: () => text },
          preventDefault,
        } as never,
      );
      expect(preventDefault).toHaveBeenCalled();
    }
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("정상 편집은 적용하고 위험한 표 트랜잭션은 거부한다", () => {
    const schema = getSchema(richTextExtensions);
    const state = EditorState.create({ schema, plugins: [richTextGuard()] });
    const edited = state.apply(state.tr.insertText("기존 내용"));
    expect(edited.doc.textContent).toBe("기존 내용");
    const { tableCell, tableRow, table: tableType } = schema.nodes;
    if (!tableCell || !tableRow || !tableType) throw new Error("missing table schema");
    const cell = tableCell.createAndFill({ colspan: 101 });
    if (!cell) throw new Error("missing cell");
    const row = tableRow.create(null, cell);
    const table = tableType.create(null, row);
    const result = edited.applyTransaction(edited.tr.insert(edited.doc.content.size, table));
    expect(result.transactions).toHaveLength(0);
    expect(result.state.doc.textContent).toBe("기존 내용");
  });
  it("범위 초과 문서 트랜잭션을 적용하지 않고 기존 내용을 보존한다", () => {
    const schema = getSchema(richTextExtensions);
    const state = EditorState.create({ schema, plugins: [richTextGuard()] });
    const result = state.applyTransaction(state.tr.insertText("x".repeat(100001)));
    expect(result.transactions).toHaveLength(0);
    expect(result.state.doc.textContent).toBe("");
  });
});

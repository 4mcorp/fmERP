import type { Block } from "@fmerp/shared/domain/form-layout";
import { resolveBlocks, validateFormLayout } from "@fmerp/shared/domain/form-layout";
import type { FormField, FormSchema } from "@fmerp/shared/domain/form-schema";
import { validateFormSchema } from "@fmerp/shared/domain/form-schema";
import { describe, expect, it } from "vitest";
import { DEFAULT_FORMS } from "../src/domain/form-defaults";
import { blocksToDocument, documentToLayout } from "../src/ui/components/form-block-document";

describe("편집기 저장 모델 왕복", () => {
  it.each(DEFAULT_FORMS)(
    "기존 $name 양식은 자동 변환·직렬화 뒤 정의와 검증 계약을 보존한다",
    (form) => {
      const source = structuredClone(form.schema);
      const saved = documentToLayout(blocksToDocument(resolveBlocks(source, {})), source, {});
      expect(saved.schema).toEqual(form.schema);
      expect(validateFormSchema(saved.schema)).toEqual({ ok: true });
      expect(validateFormLayout(saved.schema, saved.layout)).toEqual({ ok: true, warnings: [] });
      expect(source).toEqual(form.schema);
      expect(
        documentToLayout(
          blocksToDocument(resolveBlocks(saved.schema, saved.layout)),
          saved.schema,
          saved.layout,
        ),
      ).toEqual(saved);
    },
  );
  it("빈 열은 슬래시 입력 문단을 갖되 저장 시 빈 열로 왕복한다", () => {
    const blocks: Block[] = [{ kind: "columns", cols: [[], []] }];
    const doc = blocksToDocument(blocks);
    expect(doc.content?.[0]?.content?.[0]?.content).toEqual([{ type: "paragraph" }]);
    expect(documentToLayout(doc, { fields: [] }, {}).layout.blocks).toEqual(blocks);
  });
  it("13종 필드의 기존 키·상세 옵션을 유지하고 삭제한 필드는 공개 정의에서 제외한다", () => {
    const fields: FormField[] = [
      { key: "text", label: "글", type: "text", required: true, pattern: "^[가-힣]+$" },
      { key: "area", label: "여러줄", type: "textarea", maxLength: 2000 },
      { key: "num", label: "수", type: "number", integer: true, min: 0 },
      { key: "money", label: "돈", type: "money", max: 500000 },
      { key: "date", label: "일자", type: "date" },
      { key: "range", label: "기간", type: "daterange" },
      { key: "single", label: "선택", type: "select", options: [{ value: "a", label: "가" }] },
      { key: "multi", label: "다중", type: "multiselect", options: [{ value: "b", label: "나" }] },
      { key: "user", label: "담당자", type: "user", display: "employee_no" },
      { key: "dept", label: "부서", type: "dept", multiple: true },
      {
        key: "table",
        label: "표",
        type: "table",
        columns: [{ key: "amount", label: "금액", type: "money", sum: true }],
      },
      { key: "rich", label: "본문", type: "richtext" },
      { key: "files", label: "첨부", type: "attachment", maxFiles: 3 },
    ];
    const blocks: Block[] = [
      {
        kind: "columns",
        cols: [
          fields.slice(0, 4).map((f) => ({ kind: "field", key: f.key })),
          fields.slice(4, 8).map((f) => ({ kind: "field", key: f.key })),
          fields.slice(8).map((f) => ({ kind: "field", key: f.key })),
        ],
      },
    ];
    expect(
      documentToLayout(blocksToDocument(blocks), { fields }, { approvalBoxPosition: "bottom" }),
    ).toEqual({ schema: { fields }, layout: { approvalBoxPosition: "bottom", blocks } });
    expect(
      documentToLayout(blocksToDocument([{ kind: "field", key: "money" }]), { fields }, {}).schema,
    ).toEqual({ fields: [fields[3]] });
  });
  it("알 수 없는 필드·노드는 조용히 버리지 않는다", () => {
    expect(() =>
      documentToLayout(
        { type: "doc", content: [{ type: "formField", attrs: { fieldKey: "missing" } }] },
        { fields: [] },
        {},
      ),
    ).toThrow("알 수 없는 필드");
    expect(() =>
      documentToLayout({ type: "doc", content: [{ type: "unknown" }] }, { fields: [] }, {}),
    ).toThrow("지원하지 않는 편집기 블록");
  });
  it("필드 키·열·순수 텍스트·쪽 나눔을 보존하고 정의는 fields에만 둔다", () => {
    const schema: FormSchema = { fields: [{ key: "body", label: "내용", type: "text" }] };
    const blocks: Block[] = [
      { kind: "heading", level: 1, text: "안내" },
      {
        kind: "columns",
        cols: [[{ kind: "field", key: "body" }], [{ kind: "text", text: "두 줄\n설명" }]],
      },
      { kind: "divider" },
      { kind: "pagebreak" },
    ];
    const doc = blocksToDocument(blocks);
    expect(JSON.stringify(doc)).not.toContain("label");
    expect(documentToLayout(doc, schema, { orientation: "landscape" })).toEqual({
      schema,
      layout: { orientation: "landscape", blocks },
    });
  });
});

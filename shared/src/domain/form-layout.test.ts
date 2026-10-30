import { describe, expect, it } from "vitest";
import { A4_PORTRAIT_MM, PRINT_MARGIN_MM } from "./document-preview-scale";
import {
  type Block,
  deriveBlocks,
  type FormLayout,
  MAX_HEADING_LENGTH,
  MAX_LAYOUT_BLOCKS,
  MAX_LAYOUT_TEXT_LENGTH,
  MIN_WIDE_FIELD_COLUMN_MM,
  resolveBlocks,
  validateFormLayout,
} from "./form-layout";
import { type FormSchema, validateFormSchema } from "./form-schema";

const schema: FormSchema = {
  fields: [
    { key: "name", label: "이름", type: "text" },
    { key: "amount", label: "금액", type: "money", searchAmount: true },
  ],
};
const fields = (): Block[] => deriveBlocks(schema);
const check = (blocks: unknown) => validateFormLayout(schema, { blocks });

function invalid(layout: unknown, part: string) {
  const result = validateFormLayout(schema, layout);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors.join(" ")).toContain(part);
}

describe("양식 블록 배치", () => {
  it("기존 메타와 모든 종류의 블록을 허용한다", () => {
    const layout: FormLayout = {
      orientation: "landscape",
      approvalBoxPosition: "bottom",
      blocks: [
        { kind: "heading", level: 1, text: "제목" },
        { kind: "heading", level: 2, text: "소제목" },
        { kind: "text", text: "설명 & 안내 > 다음" },
        { kind: "divider" },
        { kind: "pagebreak" },
        { kind: "columns", cols: [fields().slice(0, 1), fields().slice(1)] },
      ],
    };
    expect(validateFormLayout(schema, layout)).toEqual({ ok: true, warnings: [] });
  });

  it("생략된 메타와 blocks는 기존 단일 열로 검증한다", () => {
    expect(validateFormLayout(schema, {})).toEqual({ ok: true, warnings: [] });
    expect(validateFormLayout(schema, { orientation: "portrait" }).ok).toBe(true);
    for (const approvalBoxPosition of ["top-right", "top-left", "bottom"]) {
      expect(validateFormLayout(schema, { approvalBoxPosition }).ok).toBe(true);
    }
  });

  it("누락·중복·미지 필드를 거부하고 중첩 열 사이 중복도 찾는다", () => {
    invalid({ blocks: [fields()[0]] }, "누락");
    invalid({ blocks: [...fields(), fields()[0]] }, "중복");
    invalid({ blocks: [...fields(), { kind: "field", key: "unknown" }] }, "알 수 없는");
    invalid({ blocks: [{ kind: "columns", cols: [fields(), [fields()[0]]] }] }, "중복");
    invalid({ blocks: [] }, "누락");
    expect(validateFormLayout({ fields: [] }, { blocks: [] }).ok).toBe(true);
  });

  it.each([1, 2, 4, 5])("열 수 %i의 경계를 검사한다", (count) => {
    const cols: Block[][] = Array.from({ length: count }, (_, i) => (i === 0 ? fields() : []));
    expect(check([{ kind: "columns", cols }]).ok).toBe(count >= 2 && count <= 4);
  });

  it("중첩 columns를 거부한다", () => {
    invalid(
      { blocks: [{ kind: "columns", cols: [[{ kind: "columns", cols: [fields(), []] }], []] }] },
      "중첩",
    );
  });

  it.each([0, 3, "1", null])("잘못된 heading level %s를 거부한다", (level) => {
    invalid({ blocks: [...fields(), { kind: "heading", level, text: "제목" }] }, "level");
  });

  it.each(["<", "a < b", "<script>alert(1)</script>", "<b>제목</b>"])(
    "순수 텍스트가 아닌 %s를 거부한다",
    (text) => {
      for (const kind of ["heading", "text"]) {
        invalid({ blocks: [...fields(), { kind, level: 1, text }] }, "순수 텍스트");
      }
    },
  );

  it.each([
    ["heading", MAX_HEADING_LENGTH],
    ["text", MAX_LAYOUT_TEXT_LENGTH],
  ] as const)("%s 길이 상한을 검사한다", (kind, max) => {
    expect(check([...fields(), { kind, level: 1, text: "가".repeat(max) }]).ok).toBe(true);
    expect(check([...fields(), { kind, level: 1, text: "가".repeat(max + 1) }]).ok).toBe(false);
    expect(check([...fields(), { kind, level: 1, text: "" }]).ok).toBe(true);
  });

  it("전체 300개에 columns 자체와 자식도 포함한다", () => {
    const children: Block[] = [
      ...fields(),
      ...Array.from({ length: MAX_LAYOUT_BLOCKS - 3 }, (): Block => ({ kind: "divider" })),
    ];
    expect(check([{ kind: "columns", cols: [children, []] }]).ok).toBe(true);
    children.push({ kind: "divider" });
    expect(check([{ kind: "columns", cols: [children, []] }]).ok).toBe(false);
    expect(check(Array.from({ length: 301 }, () => ({ kind: "divider" }))).ok).toBe(false);
  });

  it.each([
    null,
    [],
    false,
    "layout",
    1,
    { blocks: null },
    { blocks: {} },
    { blocks: "x" },
    { orientation: "square" },
    { orientation: null },
    { approvalBoxPosition: "left" },
    { approvalBoxPosition: null },
    { blocks: [null] },
    { blocks: [[]] },
    { blocks: [{ kind: "unknown" }] },
    { blocks: [{ kind: "field", key: 1 }] },
    { blocks: [{ kind: "heading", level: 1, text: null }] },
    { blocks: [{ kind: "text", text: 42 }] },
    { blocks: [{ kind: "columns", cols: null }] },
    { blocks: [{ kind: "columns", cols: [[], null] }] },
  ])("외부 JSON 비정상 구조를 예외 없이 거부한다: %j", (layout) => {
    expect(validateFormLayout(schema, layout).ok).toBe(false);
  });

  it("JSON이 아닌 순환·과대 배열에도 순회가 무한정 깊어지지 않는다", () => {
    const children: Block[] = [];
    const column: Block = { kind: "columns", cols: [children, []] };
    children.push(column);
    expect(check([column]).ok).toBe(false);
    expect(check(new Array(1_000_000)).ok).toBe(false);
  });
});

describe("좁은 열 경고", () => {
  const wideSchema: FormSchema = {
    fields: [
      {
        key: "table",
        label: "표",
        type: "table",
        columns: [{ key: "a", label: "A", type: "text" }],
      },
      { key: "rich", label: "본문", type: "richtext" },
      { key: "files", label: "첨부", type: "attachment" },
      { key: "text", label: "문구", type: "text" },
    ],
  };
  const blocks: Block[] = [{ kind: "columns", cols: deriveBlocks(wideSchema).map((b) => [b]) }];

  it("세로4열의 표·리치텍스트·첨부만 경고하고 저장은 허용한다", () => {
    expect((A4_PORTRAIT_MM.width - 2 * PRINT_MARGIN_MM.horizontal) / 4).toBeLessThan(
      MIN_WIDE_FIELD_COLUMN_MM,
    );
    const result = validateFormLayout(wideSchema, { orientation: "portrait", blocks });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(3);
    for (const key of ["table", "rich", "files"]) expect(result.warnings.join(" ")).toContain(key);
  });

  it("가로4열·세로3열·단일 열에서는 경고하지 않는다", () => {
    expect((A4_PORTRAIT_MM.height - 2 * PRINT_MARGIN_MM.horizontal) / 4).toBeGreaterThan(
      MIN_WIDE_FIELD_COLUMN_MM,
    );
    expect(validateFormLayout(wideSchema, { orientation: "landscape", blocks }).warnings).toEqual(
      [],
    );
    expect(
      validateFormLayout(wideSchema, {
        blocks: [{ kind: "columns", cols: [deriveBlocks(wideSchema), [], []] }],
      }).warnings,
    ).toEqual([]);
    expect(validateFormLayout(wideSchema, {}).warnings).toEqual([]);
  });

  it("오류와 경고를 독립적으로 반환한다", () => {
    const result = validateFormLayout(wideSchema, {
      blocks: [...blocks, { kind: "field", key: "bad" }],
    });
    expect(result.ok).toBe(false);
    expect(result.warnings).toHaveLength(3);
  });
});

describe("기존 버전의 읽기 전용 파생", () => {
  it("필드 순서와 searchAmount를 보존하고 원본을 바꾸지 않는다", () => {
    const original = structuredClone(schema);
    Object.freeze(schema.fields[0]);
    Object.freeze(schema.fields[1]);
    Object.freeze(schema.fields);
    Object.freeze(schema);
    expect(deriveBlocks(schema)).toEqual([
      { kind: "field", key: "name" },
      { kind: "field", key: "amount" },
    ]);
    expect(resolveBlocks(schema, {})).toEqual(deriveBlocks(schema));
    expect(schema).toEqual(original);
    expect(schema.fields[1]).toHaveProperty("searchAmount", true);
    const derived = deriveBlocks(schema);
    derived.reverse();
    expect(schema).toEqual(original);
  });

  it("명시된 blocks는 빈 배열까지 참조 그대로 반환한다", () => {
    for (const blocks of [[], fields()]) {
      expect(resolveBlocks(schema, { blocks })).toBe(blocks);
    }
  });

  it("100필드 경계에서도 원본 순서대로 파생·검증한다", () => {
    const hundred: FormSchema = {
      fields: Array.from({ length: 100 }, (_, i) => ({
        key: `f${i}`,
        label: `필드${i}`,
        type: "text",
      })),
    };
    expect(validateFormSchema(hundred).ok).toBe(true);
    expect(deriveBlocks(hundred)).toHaveLength(100);
    expect(deriveBlocks(hundred).map((b) => b.kind === "field" && b.key)).toEqual(
      hundred.fields.map((f) => f.key),
    );
    expect(validateFormLayout(hundred, {}).ok).toBe(true);
    expect(
      validateFormSchema({
        fields: [...hundred.fields, { key: "overflow", label: "초과", type: "text" }],
      }).ok,
    ).toBe(false);
  });
});

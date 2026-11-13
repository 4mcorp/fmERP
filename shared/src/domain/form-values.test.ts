import { describe, expect, it } from "vitest";
import type { FormSchema } from "./form-schema";
import { tableSums, validateFormValues } from "./form-values";

const UUID = "01914f6e-7c1a-7000-8000-000000000001";

const schema: FormSchema = {
  fields: [
    { key: "title", label: "제목", type: "text", required: true, minLength: 2, maxLength: 20 },
    { key: "phone", label: "연락처", type: "text", pattern: "^[0-9]{3}-[0-9]{4}$" },
    { key: "qty", label: "수량", type: "number", min: 1, max: 10, integer: true },
    { key: "amount", label: "금액", type: "money", required: true, min: 0, max: 100_000_000 },
    { key: "day", label: "일자", type: "date" },
    { key: "period", label: "기간", type: "daterange" },
    {
      key: "kind",
      label: "구분",
      type: "select",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    },
    {
      key: "tags",
      label: "태그",
      type: "multiselect",
      options: [
        { value: "x", label: "X" },
        { value: "y", label: "Y" },
      ],
    },
    { key: "who", label: "담당자", type: "user" },
    { key: "depts", label: "부서", type: "dept", multiple: true },
    {
      key: "items",
      label: "내역",
      type: "table",
      minRows: 1,
      maxRows: 3,
      columns: [
        { key: "name", label: "품명", type: "text", required: true },
        { key: "price", label: "단가", type: "money", sum: true },
        { key: "cnt", label: "수량", type: "number", sum: true },
      ],
    },
    { key: "body", label: "본문", type: "richtext" },
  ],
};

const valid = {
  title: "출장 신청",
  amount: 1_500_000,
  items: [{ name: "숙박", price: 100_000, cnt: 2 }],
};

const errorsOf = (values: Record<string, unknown>) => {
  const r = validateFormValues(schema, values);
  return r.ok ? [] : r.errors;
};
const fieldsWithError = (values: Record<string, unknown>) => errorsOf(values).map((e) => e.field);

describe("양식 입력값 검증 (APV-001, APV-015)", () => {
  it("필수만 채운 정상 값은 통과하고 값이 정규화된다", () => {
    const r = validateFormValues(schema, { ...valid, unknown: "무시" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values).toMatchObject({ title: "출장 신청", amount: 1_500_000 });
      expect("unknown" in r.values).toBe(false);
    }
  });

  it("필수 필드가 비면 오류", () => {
    expect(fieldsWithError({ ...valid, title: "  " })).toContain("title");
    expect(fieldsWithError({ ...valid, amount: undefined })).toContain("amount");
    expect(fieldsWithError({ ...valid, items: [] })).toContain("items");
  });

  it("텍스트: 길이·정규식", () => {
    expect(fieldsWithError({ ...valid, title: "가" })).toContain("title");
    expect(fieldsWithError({ ...valid, title: "가".repeat(21) })).toContain("title");
    expect(fieldsWithError({ ...valid, phone: "02-123" })).toContain("phone");
    expect(fieldsWithError({ ...valid, phone: "010-1234" })).toEqual([]);
  });

  it("숫자·금액: 범위, 정수, 금액은 원 단위 정수만", () => {
    expect(fieldsWithError({ ...valid, qty: 0 })).toContain("qty");
    expect(fieldsWithError({ ...valid, qty: 11 })).toContain("qty");
    expect(fieldsWithError({ ...valid, qty: 1.5 })).toContain("qty");
    expect(fieldsWithError({ ...valid, amount: 1000.5 })).toContain("amount");
    expect(fieldsWithError({ ...valid, amount: -1 })).toContain("amount");
    expect(fieldsWithError({ ...valid, amount: 100_000_001 })).toContain("amount");
    expect(fieldsWithError({ ...valid, amount: "1000" })).toContain("amount");
    expect(fieldsWithError({ ...valid, amount: Number.NaN })).toContain("amount");
  });

  it("날짜·기간: 실제 존재하는 날짜, 시작 ≤ 종료", () => {
    expect(fieldsWithError({ ...valid, day: "2026-02-30" })).toContain("day");
    expect(fieldsWithError({ ...valid, day: "26-1-1" })).toContain("day");
    expect(fieldsWithError({ ...valid, day: "2026-10-03" })).toEqual([]);
    expect(
      fieldsWithError({ ...valid, period: { from: "2026-10-05", to: "2026-10-01" } }),
    ).toContain("period");
    expect(fieldsWithError({ ...valid, period: { from: "2026-10-01", to: "2026-10-05" } })).toEqual(
      [],
    );
  });

  it("선택: 선택지에 있는 값만", () => {
    expect(fieldsWithError({ ...valid, kind: "z" })).toContain("kind");
    expect(fieldsWithError({ ...valid, kind: "a" })).toEqual([]);
    expect(fieldsWithError({ ...valid, tags: ["x", "q"] })).toContain("tags");
    expect(fieldsWithError({ ...valid, tags: ["x", "x"] })).toContain("tags");
    expect(fieldsWithError({ ...valid, tags: ["x", "y"] })).toEqual([]);
  });

  it("사용자·부서: id 형식, 다중 허용 여부", () => {
    expect(fieldsWithError({ ...valid, who: "nope" })).toContain("who");
    expect(fieldsWithError({ ...valid, who: [UUID] })).toContain("who");
    expect(fieldsWithError({ ...valid, who: UUID })).toEqual([]);
    expect(fieldsWithError({ ...valid, depts: [UUID, UUID.replace("1", "2")] })).toEqual([]);
  });

  it("표: 행 수 범위, 열 검증, 열 합계", () => {
    expect(fieldsWithError({ ...valid, items: Array(4).fill({ name: "a" }) })).toContain("items");
    expect(errorsOf({ ...valid, items: [{ price: 1 }] }).map((e) => e.field)).toContain(
      "items[0].name",
    );
    expect(
      errorsOf({ ...valid, items: [{ name: "a", price: 1.5 }] }).map((e) => e.field),
    ).toContain("items[0].price");
    expect(
      tableSums(schema, {
        items: [
          { name: "a", price: 1000, cnt: 2 },
          { name: "b", price: 2500, cnt: 3 },
        ],
      }),
    ).toEqual({
      items: { price: 3500, cnt: 5 },
    });
  });

  it("리치 텍스트: 문서 객체만, 크기 제한", () => {
    expect(fieldsWithError({ ...valid, body: "<b>x</b>" })).toContain("body");
    expect(fieldsWithError({ ...valid, body: { type: "doc", content: [] } })).toEqual([]);
    const huge = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "가".repeat(200_000) }] }],
    };
    expect(fieldsWithError({ ...valid, body: huge })).toContain("body");
  });

  it("리치 표의 위험한 span과 과도한 깊이는 저장하지 않는다", () => {
    for (const name of ["colspan", "rowspan"]) {
      for (const span of [0, -1, 1.5, "2", 1_000_000]) {
        const body = { type: "doc", content: [{ type: "tableCell", attrs: { [name]: span } }] };
        expect(fieldsWithError({ ...valid, body })).toContain("body");
      }
    }
    let body: unknown = { type: "paragraph" };
    for (let i = 0; i < 200; i++) body = { type: "paragraph", content: [body] };
    expect(fieldsWithError({ ...valid, body: { type: "doc", content: [body] } })).toContain("body");
    const many = { type: "doc", content: Array.from({ length: 11_000 }, () => ({})) };
    expect(fieldsWithError({ ...valid, body: many })).toContain("body");
    const cycle: { type: string; content?: unknown[] } = { type: "doc" };
    cycle.content = [cycle];
    expect(fieldsWithError({ ...valid, body: cycle })).toContain("body");
  });

  it("리치 표의 행과 열 수, 열 너비를 제한하면서 정상 문서는 그대로 둔다", () => {
    const cell = (attrs: Record<string, unknown>) => ({
      type: "tableCell",
      attrs,
      content: [{ type: "paragraph" }],
    });
    const table = (rows: unknown[]) => ({
      type: "doc",
      content: [{ type: "table", content: rows }],
    });
    const row = (cells: unknown[]) => ({ type: "tableRow", content: cells });
    const good = table([row([cell({ colspan: 2, rowspan: 1, colwidth: [120, 240] })])]);
    expect(validateFormValues(schema, { ...valid, body: good })).toMatchObject({
      ok: true,
      values: { body: good },
    });
    expect(
      fieldsWithError({ ...valid, body: table([row([cell({ colspan: 100 }), cell({})])]) }),
    ).toContain("body");
    expect(
      fieldsWithError({
        ...valid,
        body: table(Array.from({ length: 101 }, () => row([cell({})]))),
      }),
    ).toContain("body");
    for (const width of [["10; color:red"], [Infinity], [-1], [1000000000]]) {
      expect(
        fieldsWithError({ ...valid, body: table([row([cell({ colwidth: width })])]) }),
      ).toContain("body");
    }
  });

  it("첨부 필드는 값 없이 통과하고, 필수이면 첨부 수로 확인한다", () => {
    const withAttach: FormSchema = {
      fields: [{ key: "files", label: "첨부", type: "attachment", required: true, maxFiles: 2 }],
    };
    expect(validateFormValues(withAttach, {}, { attachmentCount: 0 }).ok).toBe(false);
    expect(validateFormValues(withAttach, {}, { attachmentCount: 1 }).ok).toBe(true);
    expect(validateFormValues(withAttach, {}, { attachmentCount: 3 }).ok).toBe(false);
  });

  it("초안 저장 모드에서는 필수 검사를 건너뛴다 (형식 오류는 여전히 거부)", () => {
    const draft = validateFormValues(schema, { title: "" }, { draft: true });
    expect(draft.ok).toBe(true);
    expect(validateFormValues(schema, { amount: 1.5 }, { draft: true }).ok).toBe(false);
  });
});

it("accepts legacy nested blockquotes within the original size limit", () => {
  let node: { type: string; content: unknown[] } = {
    type: "paragraph",
    content: [{ type: "text", text: "원문" }],
  };
  for (let i = 0; i < 35; i++) node = { type: "blockquote", content: [node] };
  expect(fieldsWithError({ ...valid, body: { type: "doc", content: [node] } })).not.toContain(
    "body",
  );
});

it("저장된 깊은 본문은 그대로 두고 다른 필드를 저장·상신하지만 수정본은 검증한다", () => {
  let node: unknown = { type: "paragraph", content: [{ type: "text", text: "기존" }] };
  for (let i = 0; i < 600; i++) node = { type: "blockquote", content: [node] };
  const body = { type: "doc", content: [node] };
  const previousValues = { ...valid, body: JSON.parse(JSON.stringify(body)) };
  for (const draft of [true, false]) {
    expect(
      validateFormValues(schema, { ...valid, title: "수정 제목", body }, { draft, previousValues })
        .ok,
    ).toBe(true);
    expect(validateFormValues(schema, { ...valid, body }, { draft }).ok).toBe(false);
    const changed = { type: "doc", content: [node, { type: "text", text: "변경" }] };
    expect(
      validateFormValues(schema, { ...valid, body: changed }, { draft, previousValues }).ok,
    ).toBe(false);
  }
});

it("저장된 넓은 이전 본문도 원래 크기 제한 안에서 보존한다", () => {
  const body = { type: "doc", content: Array.from({ length: 10001 }, () => ({})) };
  expect(JSON.stringify(body).length).toBeLessThan(100_000);
  expect(validateFormValues(schema, { ...valid, body }, { previousValues: { body } }).ok).toBe(
    true,
  );
  expect(validateFormValues(schema, { ...valid, body }).ok).toBe(false);
});

it("깊은 저장 본문에 숨긴 위험한 표도 허용하지 않는다", () => {
  let node: unknown = { type: "tableCell", attrs: { colspan: 1_000_000 } };
  for (let i = 0; i < 260; i++) node = { type: "blockquote", content: [node] };
  const body = { type: "doc", content: [node] };
  for (const draft of [true, false]) {
    expect(
      validateFormValues(schema, { ...valid, body }, { draft, previousValues: { body } }).ok,
    ).toBe(false);
  }
});

it("저장된 값이라도 위험한 표는 허용하지 않는다", () => {
  const body = {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", attrs: { colspan: 1000000 }, content: [{ type: "paragraph" }] },
            ],
          },
        ],
      },
    ],
  };
  expect(validateFormValues(schema, { ...valid, body }, { previousValues: { body } }).ok).toBe(
    false,
  );
});

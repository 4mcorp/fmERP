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

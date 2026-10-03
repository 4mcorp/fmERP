import { describe, expect, it } from "vitest";
import { extractSearchIndex } from "./form-index";
import type { FormSchema } from "./form-schema";
import { validateFormSchema } from "./form-schema";

const schema: FormSchema = {
  fields: [
    { key: "memo", label: "메모", type: "text" },
    { key: "detail", label: "상세", type: "textarea" },
    { key: "amount", label: "금액", type: "money", searchAmount: true },
    { key: "kind", label: "구분", type: "select", options: [{ value: "a", label: "교통비" }] },
    {
      key: "kinds",
      label: "복수",
      type: "multiselect",
      options: [
        { value: "x", label: "식비" },
        { value: "y", label: "숙박" },
      ],
    },
    { key: "when", label: "일자", type: "date" },
    { key: "body", label: "본문", type: "richtext" },
    {
      key: "rows",
      label: "내역",
      type: "table",
      columns: [
        { key: "item", label: "품목", type: "text" },
        { key: "price", label: "금액", type: "money" },
      ],
    },
    { key: "who", label: "담당", type: "user" },
  ],
};

describe("extractSearchIndex (APV-082)", () => {
  const values = {
    memo: "출장 정산",
    detail: "서울 출장",
    amount: 125000,
    kind: "a",
    kinds: ["x", "y"],
    when: "2026-10-01",
    body: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "본문 첫 줄" }] },
        {
          type: "paragraph",
          content: [{ type: "text", text: "둘째 줄", marks: [{ type: "bold" }] }],
        },
      ],
    },
    rows: [
      { item: "KTX 왕복", price: 59800 },
      { item: "택시", price: 12000 },
    ],
    who: "01a102b3-e7bf-743d-8b84-2ff694e4a15a",
  };

  it("텍스트·긴 글·선택 라벨·리치 텍스트·표 셀의 글자를 모은다", () => {
    const { text } = extractSearchIndex(schema, values);
    for (const word of [
      "출장 정산",
      "서울 출장",
      "교통비",
      "식비",
      "숙박",
      "본문 첫 줄",
      "둘째 줄",
      "KTX 왕복",
      "택시",
    ]) {
      expect(text, word).toContain(word);
    }
  });

  it("날짜·사용자 ID·숫자 같은 값은 본문 색인에 넣지 않는다", () => {
    const { text } = extractSearchIndex(schema, values);
    expect(text).not.toContain("2026-10-01");
    expect(text).not.toContain("01a102b3");
    expect(text).not.toContain("125000");
  });

  it("searchAmount로 지정한 금액 필드 값을 돌려준다", () => {
    expect(extractSearchIndex(schema, values).amount).toBe(125000);
  });

  it("지정한 금액 필드가 없거나 비어 있으면 amount는 null이다", () => {
    expect(extractSearchIndex(schema, { ...values, amount: undefined }).amount).toBeNull();
    const noFlag: FormSchema = {
      fields: [{ key: "amount", label: "금액", type: "money" }],
    };
    expect(extractSearchIndex(noFlag, { amount: 5000 }).amount).toBeNull();
  });

  it("숫자가 아닌 금액·정수가 아닌 값은 null로 처리한다", () => {
    expect(extractSearchIndex(schema, { ...values, amount: "많이" }).amount).toBeNull();
    expect(extractSearchIndex(schema, { ...values, amount: 10.5 }).amount).toBeNull();
  });

  it("스키마에 없는 값과 알 수 없는 선택 값은 무시한다", () => {
    const { text } = extractSearchIndex(schema, { ...values, extra: "숨겨진", kind: "zzz" });
    expect(text).not.toContain("숨겨진");
    expect(text).not.toContain("zzz");
  });

  it("빈 값은 빈 문자열을 돌려준다", () => {
    expect(extractSearchIndex(schema, {})).toEqual({ text: "", amount: null });
  });
});

describe("금액 검색 필드 지정 검증", () => {
  it("금액 필드는 한 개까지만 지정할 수 있다", () => {
    const two: FormSchema = {
      fields: [
        { key: "a", label: "금액1", type: "money", searchAmount: true },
        { key: "b", label: "금액2", type: "money", searchAmount: true },
      ],
    };
    const r = validateFormSchema(two);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/금액 검색/);
  });

  it("하나만 지정하면 통과한다", () => {
    expect(
      validateFormSchema({
        fields: [
          { key: "a", label: "금액1", type: "money", searchAmount: true },
          { key: "b", label: "금액2", type: "money" },
        ],
      }),
    ).toEqual({ ok: true });
  });
});

import { describe, expect, it } from "vitest";
import { type FormSchema, validateFormSchema } from "./form-schema";

const ok = (schema: FormSchema) => validateFormSchema(schema);

describe("양식 스키마 검증 (APV-001)", () => {
  it("모든 필드 유형을 담은 스키마가 통과한다", () => {
    const schema: FormSchema = {
      fields: [
        { key: "title", label: "제목", type: "text", required: true, maxLength: 100 },
        { key: "note", label: "비고", type: "textarea" },
        { key: "qty", label: "수량", type: "number", min: 1, integer: true },
        { key: "amount", label: "금액", type: "money", min: 0 },
        { key: "day", label: "일자", type: "date" },
        { key: "period", label: "기간", type: "daterange" },
        { key: "kind", label: "구분", type: "select", options: [{ value: "a", label: "A" }] },
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
        { key: "dept", label: "부서", type: "dept", multiple: true },
        {
          key: "items",
          label: "내역",
          type: "table",
          columns: [
            { key: "name", label: "품명", type: "text", required: true },
            { key: "price", label: "금액", type: "money", sum: true },
          ],
          minRows: 1,
          maxRows: 50,
        },
        { key: "body", label: "본문", type: "richtext" },
        { key: "files", label: "첨부", type: "attachment", maxFiles: 5 },
      ],
    };
    expect(ok(schema)).toEqual({ ok: true });
  });

  it("필드가 없거나 너무 많으면 거부", () => {
    expect(ok({ fields: [] })).toMatchObject({ ok: false });
    const many = Array.from({ length: 101 }, (_, i) => ({
      key: `f${i}`,
      label: "x",
      type: "text" as const,
    }));
    expect(ok({ fields: many })).toMatchObject({ ok: false });
  });

  it("키 형식·중복, 빈 라벨은 거부", () => {
    expect(ok({ fields: [{ key: "1bad", label: "x", type: "text" }] })).toMatchObject({
      ok: false,
    });
    expect(ok({ fields: [{ key: "has space", label: "x", type: "text" }] })).toMatchObject({
      ok: false,
    });
    expect(
      ok({
        fields: [
          { key: "a", label: "x", type: "text" },
          { key: "a", label: "y", type: "text" },
        ],
      }),
    ).toMatchObject({ ok: false });
    expect(ok({ fields: [{ key: "a", label: "  ", type: "text" }] })).toMatchObject({ ok: false });
  });

  it("선택 필드는 선택지가 있고 값이 겹치지 않아야 한다", () => {
    expect(ok({ fields: [{ key: "s", label: "s", type: "select", options: [] }] })).toMatchObject({
      ok: false,
    });
    expect(
      ok({
        fields: [
          {
            key: "s",
            label: "s",
            type: "select",
            options: [
              { value: "a", label: "1" },
              { value: "a", label: "2" },
            ],
          },
        ],
      }),
    ).toMatchObject({ ok: false });
  });

  it("표는 열이 있고 열 키가 고유하며 합계는 숫자·금액 열에만 둘 수 있다", () => {
    const table = (columns: unknown[]) =>
      ({ fields: [{ key: "t", label: "t", type: "table", columns }] }) as unknown as FormSchema;
    expect(ok(table([]))).toMatchObject({ ok: false });
    expect(
      ok(
        table([
          { key: "a", label: "a", type: "text" },
          { key: "a", label: "b", type: "text" },
        ]),
      ),
    ).toMatchObject({ ok: false });
    expect(ok(table([{ key: "a", label: "a", type: "text", sum: true }]))).toMatchObject({
      ok: false,
    });
    expect(ok(table([{ key: "a", label: "a", type: "money", sum: true }]))).toEqual({ ok: true });
  });

  it("정규식은 컴파일되어야 하고 길이·중첩 반복을 제한한다", () => {
    const withPattern = (pattern: string) =>
      ok({ fields: [{ key: "p", label: "p", type: "text", pattern }] });
    expect(withPattern("^[0-9]{3}-[0-9]{4}$")).toEqual({ ok: true });
    expect(withPattern("([")).toMatchObject({ ok: false });
    expect(withPattern("(a+)+$")).toMatchObject({ ok: false });
    expect(withPattern("a".repeat(201))).toMatchObject({ ok: false });
  });

  it("최소·최대 범위가 뒤집히면 거부", () => {
    expect(
      ok({ fields: [{ key: "n", label: "n", type: "number", min: 5, max: 1 }] }),
    ).toMatchObject({ ok: false });
    expect(
      ok({ fields: [{ key: "t", label: "t", type: "text", minLength: 5, maxLength: 1 }] }),
    ).toMatchObject({ ok: false });
  });
});

describe("formatPerson", () => {
  const p = { name: "홍길동", email: "hong@example.com", employeeNo: "P0007" };
  it("표시 방식에 따라 이름·이름+메일·사번을 돌려준다", async () => {
    const { formatPerson } = await import("./form-schema");
    expect(formatPerson(undefined, p)).toBe("홍길동");
    expect(formatPerson("name", p)).toBe("홍길동");
    expect(formatPerson("name_email", p)).toBe("홍길동 (hong@example.com)");
    expect(formatPerson("employee_no", p)).toBe("P0007");
    expect(formatPerson("employee_no", { ...p, employeeNo: null })).toBe("홍길동");
  });
});

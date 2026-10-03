import type { FormField, FormSchema, TableColumn, TableField } from "./form-schema";

/** 양식 입력값 검증과 정규화 (PRD APV-001·015). 서버와 화면이 같은 함수를 쓴다. */

export interface FieldError {
  /** 필드 키. 표 셀은 `items[0].price` 형식 */
  field: string;
  message: string;
}

export type ValuesResult =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; errors: FieldError[] };

export interface ValidateOptions {
  /** 초안 저장: 필수 검사를 건너뛰고 형식 오류만 거부한다 */
  draft?: boolean;
  /** 첨부 필드의 필수·최대 개수 확인용 (첨부는 별도 테이블에 저장된다) */
  attachmentCount?: number;
}

const MAX_RICHTEXT_BYTES = 100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isBlank = (v: unknown) =>
  v === undefined ||
  v === null ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0);

function isRealDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function checkNumber(
  value: unknown,
  opts: { min?: number; max?: number; integer?: boolean },
): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return "숫자를 입력하세요";
  if (opts.integer && !Number.isInteger(value)) return "정수를 입력하세요";
  if (opts.min !== undefined && value < opts.min) return `${opts.min} 이상이어야 합니다`;
  if (opts.max !== undefined && value > opts.max) return `${opts.max} 이하여야 합니다`;
  return null;
}

function validateCell(col: TableColumn, value: unknown): string | null {
  switch (col.type) {
    case "text":
      return typeof value === "string" && value.length <= 500
        ? null
        : "문자열이어야 합니다 (500자 이하)";
    case "number":
      return checkNumber(value, {});
    case "money":
      return checkNumber(value, { min: 0, integer: true });
    case "date":
      return isRealDate(value) ? null : "날짜 형식(YYYY-MM-DD)이 올바르지 않습니다";
  }
}

function validateTable(f: TableField, value: unknown, errors: FieldError[], draft: boolean) {
  if (!Array.isArray(value)) {
    errors.push({ field: f.key, message: "표 형식이 올바르지 않습니다" });
    return;
  }
  const min = f.minRows ?? (f.required && !draft ? 1 : 0);
  if (!draft && value.length < min)
    errors.push({ field: f.key, message: `${min}행 이상 필요합니다` });
  if (f.maxRows !== undefined && value.length > f.maxRows) {
    errors.push({ field: f.key, message: `${f.maxRows}행까지 입력할 수 있습니다` });
    return;
  }
  value.forEach((row, i) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      errors.push({ field: `${f.key}[${i}]`, message: "행 형식이 올바르지 않습니다" });
      return;
    }
    for (const col of f.columns) {
      const cell = (row as Record<string, unknown>)[col.key];
      if (isBlank(cell)) {
        if (col.required && !draft)
          errors.push({
            field: `${f.key}[${i}].${col.key}`,
            message: `${col.label}을(를) 입력하세요`,
          });
        continue;
      }
      const message = validateCell(col, cell);
      if (message)
        errors.push({ field: `${f.key}[${i}].${col.key}`, message: `${col.label}: ${message}` });
    }
  });
}

function validateField(f: FormField, value: unknown, errors: FieldError[], opts: ValidateOptions) {
  const draft = opts.draft ?? false;
  const fail = (message: string) =>
    errors.push({ field: f.key, message: `${f.label}: ${message}` });

  if (f.type === "attachment") {
    const n = opts.attachmentCount ?? 0;
    if (!draft && f.required && n < 1) fail("첨부가 필요합니다");
    if (f.maxFiles !== undefined && n > f.maxFiles) fail(`첨부는 ${f.maxFiles}개까지입니다`);
    return;
  }
  if (f.type === "table") {
    if (isBlank(value)) {
      const min = f.minRows ?? (f.required ? 1 : 0);
      if (min > 0 && !draft) fail(`${min}행 이상 입력하세요`);
      return;
    }
    validateTable(f, value, errors, draft);
    return;
  }
  if (isBlank(value)) {
    if (f.required && !draft) fail("필수 항목입니다");
    return;
  }

  switch (f.type) {
    case "text":
    case "textarea": {
      if (typeof value !== "string") return fail("문자열이어야 합니다");
      if (f.minLength !== undefined && value.trim().length < f.minLength)
        fail(`${f.minLength}자 이상이어야 합니다`);
      if (f.maxLength !== undefined && value.length > f.maxLength)
        fail(`${f.maxLength}자 이하여야 합니다`);
      if (value.length > 20_000) fail("너무 깁니다");
      if (f.pattern !== undefined && !new RegExp(f.pattern).test(value))
        fail("형식이 올바르지 않습니다");
      return;
    }
    case "number": {
      const m = checkNumber(value, { min: f.min, max: f.max, integer: f.integer });
      if (m) fail(m);
      return;
    }
    case "money": {
      const m = checkNumber(value, { min: f.min ?? 0, max: f.max, integer: true });
      if (m) fail(m);
      return;
    }
    case "date":
      if (!isRealDate(value)) fail("날짜 형식(YYYY-MM-DD)이 올바르지 않습니다");
      return;
    case "daterange": {
      const range = value as { from?: unknown; to?: unknown };
      if (!isRealDate(range.from) || !isRealDate(range.to))
        return fail("기간의 시작·종료일이 올바르지 않습니다");
      if (range.from > range.to) fail("종료일은 시작일 이후여야 합니다");
      return;
    }
    case "select":
      if (typeof value !== "string" || !f.options.some((o) => o.value === value))
        fail("선택지에 없는 값입니다");
      return;
    case "multiselect": {
      const list = Array.isArray(value) ? value : null;
      const allowed = new Set(f.options.map((o) => o.value));
      if (
        !list ||
        list.some((v) => typeof v !== "string" || !allowed.has(v)) ||
        new Set(list).size !== list.length
      ) {
        fail("선택지에 없거나 중복된 값이 있습니다");
      }
      return;
    }
    case "user":
    case "dept": {
      const ids = f.multiple ? value : [value];
      if (!Array.isArray(ids) || ids.some((v) => typeof v !== "string" || !UUID.test(v))) {
        fail(f.multiple ? "여러 항목의 id 형식이 올바르지 않습니다" : "선택값이 올바르지 않습니다");
      }
      return;
    }
    case "richtext": {
      const doc = value as { type?: unknown };
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        doc.type !== "doc"
      ) {
        return fail("본문 형식이 올바르지 않습니다");
      }
      if (JSON.stringify(value).length > MAX_RICHTEXT_BYTES) fail("본문이 너무 깁니다");
      return;
    }
  }
}

/**
 * 스키마에 정의된 필드만 남겨 검증한다. 모르는 키는 버린다.
 * 반환 값은 저장해도 되는 정규화된 입력값이다.
 */
export function validateFormValues(
  schema: FormSchema,
  input: Record<string, unknown>,
  opts: ValidateOptions = {},
): ValuesResult {
  const errors: FieldError[] = [];
  const values: Record<string, unknown> = {};
  for (const f of schema.fields) {
    if (f.type === "attachment") {
      validateField(f, undefined, errors, opts);
      continue;
    }
    let value = input[f.key];
    if (typeof value === "string" && (f.type === "text" || f.type === "textarea"))
      value = value.trim();
    validateField(f, value, errors, opts);
    if (!isBlank(value)) values[f.key] = value;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, values };
}

/** 표 필드의 열 합계 (sum 표시된 열만) */
export function tableSums(
  schema: FormSchema,
  values: Record<string, unknown>,
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const f of schema.fields) {
    if (f.type !== "table") continue;
    const rows = Array.isArray(values[f.key]) ? (values[f.key] as Record<string, unknown>[]) : [];
    const sums: Record<string, number> = {};
    for (const col of f.columns) {
      if (!col.sum) continue;
      sums[col.key] = rows.reduce(
        (acc, row) => acc + (typeof row?.[col.key] === "number" ? (row[col.key] as number) : 0),
        0,
      );
    }
    if (Object.keys(sums).length > 0) result[f.key] = sums;
  }
  return result;
}

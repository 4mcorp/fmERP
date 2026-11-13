/** 양식 필드 스키마 (PRD APV-001, D8: 필드 나열 + 표 + 리치 텍스트). 순수 데이터와 검증이며 외부 의존성이 없다. */

interface Base {
  key: string;
  label: string;
  required?: boolean;
  help?: string;
}

interface TextField extends Base {
  type: "text" | "textarea";
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: string;
}
interface NumberField extends Base {
  type: "number";
  min?: number;
  max?: number;
  integer?: boolean;
  default?: number;
}
/** 금액: 원 단위 정수 (ADR 0002) */
interface MoneyField extends Base {
  type: "money";
  min?: number;
  max?: number;
  default?: number;
  /** 금액 범위 검색의 기준 필드 (APV-082). 양식에 하나만 지정할 수 있다 */
  searchAmount?: boolean;
}
interface DateField extends Base {
  type: "date" | "daterange";
}
interface SelectOption {
  value: string;
  label: string;
}
interface SelectField extends Base {
  type: "select" | "multiselect";
  options: SelectOption[];
  default?: string | string[];
}
export const USER_DISPLAYS = ["name", "name_email", "employee_no"] as const;
export type UserDisplay = (typeof USER_DISPLAYS)[number];
export const USER_DISPLAY_LABEL: Record<UserDisplay, string> = {
  name: "이름",
  name_email: "이름 + 메일",
  employee_no: "사번",
};

interface RefField extends Base {
  type: "user" | "dept";
  multiple?: boolean;
  /** user 필드의 표시 방식. 기본은 이름. 값은 구성원 id만 저장하므로 표시만 달라진다 */
  display?: UserDisplay;
}

export interface PersonInfo {
  name: string;
  email: string;
  employeeNo: string | null;
}

/** 구성원을 필드 설정에 맞게 한 줄로 표시한다 */
export function formatPerson(display: UserDisplay | undefined, p: PersonInfo): string {
  if (display === "employee_no") return p.employeeNo ?? p.name;
  if (display === "name_email") return `${p.name} (${p.email})`;
  return p.name;
}
export interface TableColumn {
  key: string;
  label: string;
  type: "text" | "number" | "money" | "date";
  required?: boolean;
  /** 열 합계를 계산한다 (숫자·금액 열만) */
  sum?: boolean;
}
export interface TableField extends Base {
  type: "table";
  columns: TableColumn[];
  minRows?: number;
  maxRows?: number;
}
interface RichTextField extends Base {
  type: "richtext";
}
interface AttachmentField extends Base {
  type: "attachment";
  maxFiles?: number;
}

export type FormField =
  | TextField
  | NumberField
  | MoneyField
  | DateField
  | SelectField
  | RefField
  | TableField
  | RichTextField
  | AttachmentField;

export interface FormSchema {
  fields: FormField[];
}

const MAX_FIELDS = 100;
const KEY = /^[a-z][a-zA-Z0-9_]{0,39}$/;
const MAX_PATTERN_LENGTH = 200;
/** (a+)+ 처럼 괄호 안의 반복이 다시 반복되는 정규식은 처리 시간이 폭증할 수 있어 막는다 */
const NESTED_QUANTIFIER = /\([^)]*[*+}][^)]*\)[*+{]/;

export type SchemaCheck = { ok: true } | { ok: false; errors: string[] };

function checkPattern(pattern: string, label: string, errors: string[]) {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    errors.push(`${label}: 정규식은 ${MAX_PATTERN_LENGTH}자 이하여야 합니다`);
    return;
  }
  if (NESTED_QUANTIFIER.test(pattern)) {
    errors.push(`${label}: 중첩 반복이 있는 정규식은 사용할 수 없습니다`);
    return;
  }
  try {
    new RegExp(pattern);
  } catch {
    errors.push(`${label}: 올바르지 않은 정규식입니다`);
  }
}

function checkRange(
  min: number | undefined,
  max: number | undefined,
  label: string,
  errors: string[],
) {
  if (min !== undefined && max !== undefined && min > max) {
    errors.push(`${label}: 최소값이 최대값보다 클 수 없습니다`);
  }
}

export function validateFormSchema(schema: FormSchema): SchemaCheck {
  const errors: string[] = [];
  if (schema.fields.length === 0) errors.push("필드가 하나 이상 필요합니다");
  if (schema.fields.length > MAX_FIELDS) errors.push(`필드는 ${MAX_FIELDS}개까지 둘 수 있습니다`);

  if (schema.fields.filter((f) => f.type === "money" && f.searchAmount).length > 1) {
    errors.push("금액 검색 기준 필드는 하나만 지정할 수 있습니다");
  }

  const seen = new Set<string>();
  for (const f of schema.fields) {
    const label = f.label.trim() || f.key;
    if (!KEY.test(f.key))
      errors.push(`${label}: 키는 영문 소문자로 시작하는 영문·숫자·_ 40자 이하여야 합니다`);
    if (seen.has(f.key)) errors.push(`${label}: 키가 중복되었습니다 (${f.key})`);
    seen.add(f.key);
    if (f.label.trim() === "") errors.push(`${f.key}: 라벨이 비어 있습니다`);

    switch (f.type) {
      case "text":
      case "textarea":
        if (f.pattern !== undefined) checkPattern(f.pattern, label, errors);
        checkRange(f.minLength, f.maxLength, label, errors);
        break;
      case "number":
      case "money":
        checkRange(f.min, f.max, label, errors);
        break;
      case "select":
      case "multiselect": {
        if (f.options.length === 0) errors.push(`${label}: 선택지가 필요합니다`);
        const values = f.options.map((o) => o.value);
        if (new Set(values).size !== values.length)
          errors.push(`${label}: 선택지 값이 중복되었습니다`);
        if (f.options.some((o) => o.label.trim() === ""))
          errors.push(`${label}: 선택지 라벨이 비어 있습니다`);
        break;
      }
      case "table": {
        if (f.columns.length === 0) errors.push(`${label}: 열이 하나 이상 필요합니다`);
        const cols = new Set<string>();
        for (const c of f.columns) {
          if (!KEY.test(c.key)) errors.push(`${label}.${c.key}: 열 키 형식이 올바르지 않습니다`);
          if (cols.has(c.key)) errors.push(`${label}: 열 키가 중복되었습니다 (${c.key})`);
          cols.add(c.key);
          if (c.sum && c.type !== "number" && c.type !== "money") {
            errors.push(`${label}.${c.key}: 합계는 숫자·금액 열에만 둘 수 있습니다`);
          }
        }
        checkRange(f.minRows, f.maxRows, label, errors);
        break;
      }
      default:
        break;
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

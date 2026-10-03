import type { FormSchema } from "./form-schema";

/** 문서 검색용 색인 (PRD APV-082, ADR 0009). 양식 입력값에서 본문 전문 검색용 글자와 금액을 뽑는다. 순수 함수다. */

export interface SearchIndex {
  /** 줄바꿈으로 이은 검색용 글자 */
  text: string;
  /** `searchAmount`로 지정한 금액 필드의 값(원). 지정이 없거나 값이 없으면 null */
  amount: number | null;
}

/** tiptap 문서 JSON에서 글자만 모은다 */
function richText(node: unknown, out: string[]): void {
  if (typeof node !== "object" || node === null) return;
  const n = node as { type?: unknown; text?: unknown; content?: unknown };
  if (typeof n.text === "string") out.push(n.text);
  if (Array.isArray(n.content)) {
    for (const child of n.content) richText(child, out);
    // 문단·제목 같은 블록 사이는 줄바꿈으로 구분한다
    if (n.type !== "doc" && n.type !== "text") out.push("\n");
  }
}

const isString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

export function extractSearchIndex(
  schema: FormSchema,
  values: Record<string, unknown>,
): SearchIndex {
  const parts: string[] = [];
  let amount: number | null = null;

  for (const field of schema.fields) {
    const value = values[field.key];
    if (value === undefined || value === null) continue;
    switch (field.type) {
      case "text":
      case "textarea":
        if (isString(value)) parts.push(value);
        break;
      case "select": {
        const label = field.options.find((o) => o.value === value)?.label;
        if (label) parts.push(label);
        break;
      }
      case "multiselect": {
        if (!Array.isArray(value)) break;
        for (const v of value) {
          const label = field.options.find((o) => o.value === v)?.label;
          if (label) parts.push(label);
        }
        break;
      }
      case "richtext": {
        const out: string[] = [];
        richText(value, out);
        const joined = out
          .join("")
          .replace(/\n{2,}/g, "\n")
          .trim();
        if (joined) parts.push(joined);
        break;
      }
      case "table": {
        if (!Array.isArray(value)) break;
        for (const row of value) {
          if (typeof row !== "object" || row === null) continue;
          for (const col of field.columns) {
            const cell = (row as Record<string, unknown>)[col.key];
            if (col.type === "text" && isString(cell)) parts.push(cell);
          }
        }
        break;
      }
      case "money":
        if (field.searchAmount && typeof value === "number" && Number.isInteger(value)) {
          amount = value;
        }
        break;
      default:
        // 숫자·날짜·구성원·부서·첨부는 본문 글자 검색 대상이 아니다
        break;
    }
  }
  return { text: parts.join("\n"), amount };
}

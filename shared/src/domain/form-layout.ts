import { A4_PORTRAIT_MM, PRINT_MARGIN_MM } from "./document-preview-scale";
import type { FormSchema } from "./form-schema";

export type Block =
  | { kind: "field"; key: string }
  | { kind: "heading"; level: 1 | 2; text: string }
  | { kind: "text"; text: string }
  | { kind: "divider" }
  | { kind: "pagebreak" }
  | { kind: "columns"; cols: Block[][] };

export interface FormLayout {
  /** 생략된 기존 버전은 portrait / top-right로 표시한다. */
  orientation?: "portrait" | "landscape";
  approvalBoxPosition?: "top-right" | "top-left" | "bottom";
  blocks?: Block[];
}

export const MAX_LAYOUT_BLOCKS = 300;
/** JS string.length 기준 UTF-16 code unit 수. */
export const MAX_LAYOUT_TEXT_LENGTH = 2000;
export const MAX_HEADING_LENGTH = 200;
/**
 * A4 본문 폭(좌우 12mm 제외)을 균등 분할한 명목 폭 기준이다(gap 미반영).
 * 계획의 40mm는 예시이며, 여유를 둔 50mm를 경고선으로 쓴다.
 * 세로4열은 46.5mm로 경고, 가로4열은 68.25mm로 허용한다. 저장은 막지 않는다.
 */
export const MIN_WIDE_FIELD_COLUMN_MM = 50;

export type LayoutCheck =
  | { ok: true; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

export function deriveBlocks(schema: FormSchema): Block[] {
  return schema.fields.map(({ key }) => ({ kind: "field", key }));
}

/** 검증된 배치 또는 기존 버전을 읽을 때만 파생한다. 원본 버전에는 쓰지 않는다. */
export function resolveBlocks(schema: FormSchema, layout: FormLayout): Block[] {
  return layout.blocks === undefined ? deriveBlocks(schema) : layout.blocks;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** schema는 기존 validateFormSchema 계약을 따른다. layout은 외부 JSON도 검사한다. */
export function validateFormLayout(schema: FormSchema, layout: unknown): LayoutCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const result = (): LayoutCheck =>
    errors.length ? { ok: false, errors, warnings } : { ok: true, warnings };

  if (!isRecord(layout)) {
    errors.push("layout은 객체여야 합니다");
    return result();
  }
  if (
    layout.orientation !== undefined &&
    layout.orientation !== "portrait" &&
    layout.orientation !== "landscape"
  ) {
    errors.push("orientation은 portrait 또는 landscape여야 합니다");
  }
  if (
    layout.approvalBoxPosition !== undefined &&
    layout.approvalBoxPosition !== "top-right" &&
    layout.approvalBoxPosition !== "top-left" &&
    layout.approvalBoxPosition !== "bottom"
  ) {
    errors.push("approvalBoxPosition은 top-right, top-left, bottom 중 하나여야 합니다");
  }

  const definitions = new Map(schema.fields.map((field) => [field.key, field]));
  const seen = new Set<string>();
  const pageWidth =
    layout.orientation === "landscape" ? A4_PORTRAIT_MM.height : A4_PORTRAIT_MM.width;
  const contentWidth = pageWidth - 2 * PRINT_MARGIN_MM.horizontal;
  let count = 0;

  function checkText(value: unknown, max: number, path: string) {
    if (typeof value !== "string") {
      errors.push(`${path}: text는 문자열이어야 합니다`);
    } else {
      if (value.length > max) errors.push(`${path}: text는 ${max}자 이하여야 합니다`);
      if (value.includes("<")) errors.push(`${path}: '<' 없는 순수 텍스트만 허용합니다`);
    }
  }

  function visit(blocks: unknown, path: string, columnWidth?: number) {
    if (!Array.isArray(blocks)) {
      errors.push(`${path}: 블록 배열이어야 합니다`);
      return;
    }
    // 과대 배열·순환 입력도 300블록 예산과 최대 2단계 깊이에서 끝낸다.
    if (blocks.length > MAX_LAYOUT_BLOCKS - count) {
      errors.push(`블록은 자식을 포함해 ${MAX_LAYOUT_BLOCKS}개까지 둘 수 있습니다`);
      return;
    }
    for (const [index, block] of blocks.entries()) {
      if (++count > MAX_LAYOUT_BLOCKS) {
        errors.push(`블록은 자식을 포함해 ${MAX_LAYOUT_BLOCKS}개까지 둘 수 있습니다`);
        return;
      }
      const at = `${path}[${index}]`;
      if (!isRecord(block)) {
        errors.push(`${at}: 블록은 객체여야 합니다`);
        continue;
      }
      switch (block.kind) {
        case "field": {
          if (typeof block.key !== "string") {
            errors.push(`${at}: field.key는 문자열이어야 합니다`);
            break;
          }
          const field = definitions.get(block.key);
          if (!field) errors.push(`${at}: 알 수 없는 필드 (${block.key})`);
          if (seen.has(block.key)) errors.push(`${at}: 필드 중복 (${block.key})`);
          seen.add(block.key);
          if (
            field &&
            columnWidth !== undefined &&
            columnWidth < MIN_WIDE_FIELD_COLUMN_MM &&
            (field.type === "table" || field.type === "richtext" || field.type === "attachment")
          ) {
            warnings.push(
              `${at}: ${block.key} 필드의 열 폭 ${columnWidth}mm가 권장 ${MIN_WIDE_FIELD_COLUMN_MM}mm보다 좁습니다`,
            );
          }
          break;
        }
        case "heading":
          if (block.level !== 1 && block.level !== 2)
            errors.push(`${at}: heading.level은 1 또는 2여야 합니다`);
          checkText(block.text, MAX_HEADING_LENGTH, at);
          break;
        case "text":
          checkText(block.text, MAX_LAYOUT_TEXT_LENGTH, at);
          break;
        case "divider":
        case "pagebreak":
          break;
        case "columns":
          if (columnWidth !== undefined) {
            errors.push(`${at}: columns 중첩은 허용하지 않습니다`);
          } else if (!Array.isArray(block.cols) || block.cols.length < 2 || block.cols.length > 4) {
            errors.push(`${at}: columns는 2~4열이어야 합니다`);
          } else {
            const width = contentWidth / block.cols.length;
            for (const [col, children] of block.cols.entries())
              visit(children, `${at}.cols[${col}]`, width);
          }
          break;
        default:
          errors.push(`${at}: 알 수 없는 블록 kind`);
      }
    }
  }

  visit(layout.blocks === undefined ? deriveBlocks(schema) : layout.blocks, "blocks");
  for (const key of definitions.keys()) {
    if (!seen.has(key)) errors.push(`필드 누락 (${key})`);
  }
  return result();
}

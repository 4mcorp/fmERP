import type { Block } from "./form-layout";
import type { FormField } from "./form-schema";

export type BlockMode = "edit" | "fill" | "view" | "print";

export interface BlockContext {
  mode: BlockMode;
  canEditStructure: boolean;
  canEditValues: boolean;
}

export interface BlockAdapter<T> {
  text(value: string): T;
  element(tag: "div" | "h1" | "h2" | "p" | "hr", attrs: Record<string, string>, children: T[]): T;
  /** 필드 값/위젯만 반환한다. undefined는 해당 필드를 숨긴다. 라벨·틀은 공통 렌더러 소유다. */
  field(field: FormField, context: BlockContext): T | undefined;
  label?(field: FormField, context: BlockContext): T;
}

/** 검증된 fields/blocks를 받는다. DOM·React·PDF가 같은 순회와 배치 클래스를 사용한다. */
export function renderBlocks<T>(input: {
  fields: FormField[];
  blocks: Block[];
  mode: BlockMode;
  adapter: BlockAdapter<T>;
  /** blocks가 없는 기존 버전만 기존 50% / wide 배치를 유지한다. */
  legacy?: boolean;
}): T {
  const { adapter, mode } = input;
  const definitions = new Map(input.fields.map((field) => [field.key, field]));
  const context: BlockContext = {
    mode,
    canEditStructure: mode === "edit",
    canEditValues: mode === "fill",
  };
  const element = (tag: Parameters<typeof adapter.element>[0], className: string, children: T[]) =>
    adapter.element(tag, { class: className }, children);
  const visit = (blocks: Block[]): T[] =>
    blocks
      .map((block) => {
        switch (block.kind) {
          case "field": {
            const field = definitions.get(block.key);
            if (!field) throw new Error(`알 수 없는 필드 (${block.key})`);
            const value = adapter.field(field, context);
            if (value === undefined) return undefined;
            const wide =
              field.type === "table" || field.type === "richtext" || field.type === "attachment";
            const content =
              field.type === "richtext"
                ? element("div", "rich", [value])
                : wide
                  ? value
                  : element("div", "value", [value]);
            return element("div", wide ? "field wide" : "field", [
              element("div", "label", [
                adapter.label?.(field, context) ?? adapter.text(field.label),
              ]),
              content,
            ]);
          }
          case "heading":
            return element(block.level === 1 ? "h1" : "h2", "block-heading", [
              adapter.text(block.text),
            ]);
          case "text":
            return element("p", "block-text", [adapter.text(block.text)]);
          case "divider":
            return element("hr", "block-divider", []);
          case "pagebreak":
            return element("div", "block-pagebreak", [adapter.text("쪽 나눔")]);
          case "columns":
            return element("div", "block-columns-scroll", [
              element(
                "div",
                `block-columns block-columns-${block.cols.length}`,
                block.cols.map((children) => element("div", "block-column", visit(children))),
              ),
            ]);
          default:
            throw new Error(`지원하지 않는 블록: ${block satisfies never}`);
        }
      })
      .filter((node): node is T => node !== undefined);
  return adapter.element(
    "div",
    {
      class: `form-blocks fields${input.legacy ? " legacy-fields" : ""}`,
      "data-mode": mode,
    },
    visit(input.blocks),
  );
}

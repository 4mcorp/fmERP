import type { Block, FormLayout } from "@fmerp/shared/domain/form-layout";
import type { FormSchema } from "@fmerp/shared/domain/form-schema";
import type { JSONContent } from "@tiptap/core";

export function blocksToDocument(blocks: Block[]): JSONContent {
  const node = (block: Block): JSONContent => {
    switch (block.kind) {
      case "field":
        return { type: "formField", attrs: { fieldKey: block.key } };
      case "columns":
        return {
          type: "formColumns",
          content: block.cols.map((children) => ({
            type: "formColumn",
            content: [...children.map(node), { type: "paragraph" }],
          })),
        };
      case "heading":
        return {
          type: "formHeading",
          attrs: { level: block.level },
          content: block.text ? [{ type: "text", text: block.text }] : [],
        };
      case "text":
        return {
          type: "paragraph",
          content: block.text ? [{ type: "text", text: block.text }] : [],
        };
      case "divider":
        return { type: "formDivider" };
      case "pagebreak":
        return { type: "formPagebreak" };
    }
  };
  return { type: "doc", content: [...blocks.map(node), { type: "paragraph" }] };
}

export function documentToLayout(doc: JSONContent, definitions: FormSchema, layout: FormLayout) {
  const keys: string[] = [];
  function block(node: JSONContent): Block {
    switch (node.type) {
      case "formField": {
        const key: unknown = node.attrs?.fieldKey;
        if (typeof key !== "string") throw new Error("필드 키가 없습니다");
        keys.push(key);
        return { kind: "field", key };
      }
      case "formColumns":
        return {
          kind: "columns",
          cols: (node.content ?? []).map((col) => childrenToBlocks(col.content ?? [])),
        };
      case "formHeading":
        return { kind: "heading", level: node.attrs?.level === 1 ? 1 : 2, text: text(node) };
      case "paragraph":
        return { kind: "text", text: text(node) };
      case "formDivider":
        return { kind: "divider" };
      case "formPagebreak":
        return { kind: "pagebreak" };
      default:
        throw new Error("지원하지 않는 편집기 블록입니다");
    }
  }
  function childrenToBlocks(children: JSONContent[]) {
    const nodes = [...children];
    // 본문·각 열의 마지막 빈 문단은 슬래시 입력용이며 저장하지 않는다.
    if (nodes.at(-1)?.type === "paragraph" && !text(nodes.at(-1))) nodes.pop();
    return nodes.map(block);
  }
  const blocks = childrenToBlocks(doc.content ?? []);
  const byKey = new Map(definitions.fields.map((field) => [field.key, field]));
  const schema: FormSchema = {
    fields: keys.map((key) => {
      const field = byKey.get(key);
      if (!field) throw new Error(`알 수 없는 필드 (${key})`);
      return field;
    }),
  };
  const nextLayout = { ...layout, blocks };
  return { schema, layout: nextLayout };
}

function text(node: JSONContent | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(text).join("");
}

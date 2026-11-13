// Never pass unsupported legacy content to ProseMirror: it may silently discard it.
const nodes = new Set([
  "doc",
  "text",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "hardBreak",
  "horizontalRule",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
]);
const marks = new Set(["bold", "italic", "strike", "code", "link", "underline"]);

export function editorSupportsRichText(value: unknown): boolean {
  const stack: unknown[] = [value];
  let count = 0;
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || ++count > 10000) return false;
    const n = node as { type?: string; content?: unknown; marks?: { type?: string }[] };
    if (
      !n.type ||
      !nodes.has(n.type) ||
      (n.marks && (!Array.isArray(n.marks) || n.marks.some((m) => !m?.type || !marks.has(m.type))))
    )
      return false;
    if (n.content !== undefined) {
      if (!Array.isArray(n.content)) return false;
      stack.push(...n.content);
    }
  }
  return true;
}

export function legacyRichText(value: unknown): string | null {
  const stack: { value: unknown; exit?: boolean }[] = [{ value }];
  const ancestors = new Set<object>();
  const result: string[] = [];
  let count = 0;
  let chars = 0;
  while (stack.length) {
    const item = stack.pop();
    if (!item?.value || typeof item.value !== "object") return null;
    if (item.exit) {
      ancestors.delete(item.value);
      const type = (item.value as { type?: unknown }).type;
      if (type === "paragraph" || type === "heading" || type === "codeBlock") result.push("\n");
      continue;
    }
    if (ancestors.has(item.value) || ++count > 100000) return null;
    ancestors.add(item.value);
    stack.push({ ...item, exit: true });
    const node = item.value as { type?: unknown; text?: unknown; content?: unknown };
    if (typeof node.text === "string") {
      chars += node.text.length;
      if (chars > 100000) return null;
      result.push(node.text);
    }
    if (node.type === "hardBreak") result.push("\n");
    if (node.content !== undefined) {
      if (!Array.isArray(node.content) || node.content.length > 100000 - count) return null;
      for (let i = node.content.length - 1; i >= 0; i--) stack.push({ value: node.content[i] });
    }
  }
  if (result[result.length - 1] === "\n") result.pop();
  return result.join("");
}

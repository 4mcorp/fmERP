// Bound both input traversal and ProseMirror's table map allocations.
export const MAX_RICH_TABLE_SPAN = 100;
const MAX_DEPTH = 256;
const MAX_OBJECTS = 10_000;

export function isSafeRichText(
  value: unknown,
  maxDepth = MAX_DEPTH,
  maxObjects = MAX_OBJECTS,
): boolean {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as { type?: unknown }).type !== "doc"
  )
    return false;
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [{ value, depth: 0 }];
  const ancestors = new Set<object>();
  let count = 0;
  while (stack.length) {
    const item = stack.pop();
    if (!item?.value || typeof item.value !== "object") continue;
    if (item.exit) {
      ancestors.delete(item.value);
      continue;
    }
    if (item.depth > maxDepth || ancestors.has(item.value) || ++count > maxObjects) return false;
    ancestors.add(item.value);
    stack.push({ ...item, exit: true });
    const node = item.value as Record<string, unknown>;
    if (node.type === "tableCell" || node.type === "tableHeader") {
      const attrs = node.attrs as Record<string, unknown> | null | undefined;
      const widths = attrs?.colwidth;
      if (
        widths != null &&
        (!Array.isArray(widths) ||
          widths.length > MAX_RICH_TABLE_SPAN ||
          widths.some(
            (width) =>
              typeof width !== "number" || !Number.isInteger(width) || width < 0 || width > 10000,
          ))
      )
        return false;
      for (const name of ["colspan", "rowspan"]) {
        const span = attrs?.[name];
        if (
          span !== undefined &&
          (typeof span !== "number" ||
            !Number.isInteger(span) ||
            span < 1 ||
            span > MAX_RICH_TABLE_SPAN)
        )
          return false;
      }
    }
    if (node.type === "table" && Array.isArray(node.content)) {
      if (node.content.length > MAX_RICH_TABLE_SPAN) return false;
      // Bound work before examining previous rowspans; a row cannot exceed the width limit.
      for (const row of node.content) {
        if (
          row &&
          typeof row === "object" &&
          Array.isArray(row.content) &&
          row.content.length > MAX_RICH_TABLE_SPAN
        )
          return false;
      }
      for (let r = 0; r < node.content.length; r++) {
        const row = node.content[r];
        if (row && typeof row === "object" && Array.isArray(row.content)) {
          let columns = 0;
          for (let previous = 0; previous < r; previous++) {
            const prior = node.content[previous];
            if (!prior || typeof prior !== "object" || !Array.isArray(prior.content)) continue;
            for (const cell of prior.content) {
              const rowspan = cell?.attrs?.rowspan ?? 1;
              const colspan = cell?.attrs?.colspan ?? 1;
              if (
                !Number.isInteger(rowspan) ||
                !Number.isInteger(colspan) ||
                rowspan < 1 ||
                rowspan > MAX_RICH_TABLE_SPAN ||
                colspan < 1 ||
                colspan > MAX_RICH_TABLE_SPAN
              )
                return false;
              if (previous + rowspan > r) columns += colspan;
              if (columns > MAX_RICH_TABLE_SPAN) return false;
            }
          }
          for (const cell of row.content) {
            const span = cell?.attrs?.colspan ?? 1;
            if (
              typeof span !== "number" ||
              !Number.isInteger(span) ||
              span < 1 ||
              span > MAX_RICH_TABLE_SPAN
            )
              return false;
            columns += span;
            if (columns > MAX_RICH_TABLE_SPAN) return false;
          }
        }
      }
    }
    for (const child of Object.values(node)) {
      if (child && typeof child === "object") stack.push({ value: child, depth: item.depth + 1 });
    }
  }
  try {
    return JSON.stringify(value).length <= 100_000;
  } catch {
    return false;
  }
}

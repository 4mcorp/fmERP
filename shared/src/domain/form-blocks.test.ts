import { describe, expect, it } from "vitest";
import { renderBlocks } from "./form-blocks";
import type { FormSchema } from "./form-schema";

const fields: FormSchema["fields"] = [{ key: "memo", type: "text", label: "메모" }];

describe("renderBlocks", () => {
  it("블록 순서와 모드별 편집 권한을 필드 어댑터에 전달한다", () => {
    for (const mode of ["edit", "fill", "view", "print"] as const) {
      const seen: unknown[] = [];
      const result = renderBlocks({
        fields,
        blocks: [
          { kind: "heading", level: 2, text: "안내" },
          { kind: "field", key: "memo" },
        ],
        mode,
        adapter: {
          text: (value: string) => value,
          element: (tag, attrs, children) =>
            `${tag}:${JSON.stringify(attrs)}[${children.join("")}]`,
          field: (field, context) => {
            seen.push({ key: field.key, ...context });
            return "필드";
          },
        },
      });
      expect(result).toContain('"class":"field"');
      expect(result).toContain('"class":"label"');
      expect(result).toContain('"class":"value"');
      expect(result.indexOf("안내")).toBeLessThan(result.indexOf("필드"));
      expect(seen).toEqual([
        { key: "memo", mode, canEditStructure: mode === "edit", canEditValues: mode === "fill" },
      ]);
    }
  });
});

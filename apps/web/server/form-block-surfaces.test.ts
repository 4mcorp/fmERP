import { FormValuesView } from "@fmerp/feature-approval/ui/components/form-view";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const schema = {
  fields: [
    { key: "first", type: "text" as const, label: "첫 항목" },
    { key: "second", type: "text" as const, label: "둘째 항목" },
    { key: "files", type: "attachment" as const, label: "첨부" },
  ],
};

describe("문서 조회 블록 화면", () => {
  it("저장된 배치의 순서·다중 열·정적 블록을 읽기 전용으로 표시한다", () => {
    const html = renderToStaticMarkup(
      createElement(FormValuesView, {
        schema,
        layout: {
          blocks: [
            { kind: "heading", level: 2, text: "문서 안내" },
            {
              kind: "columns",
              cols: [[{ kind: "field", key: "second" }], [{ kind: "field", key: "first" }]],
            },
            { kind: "divider" },
            { kind: "text", text: "<script>안전한 설명</script>" },
            { kind: "pagebreak" },
            { kind: "field", key: "files" },
          ],
        },
        values: { first: "첫 값", second: "둘째 값" },
        ctx: { members: [], departments: [] },
      }),
    );
    expect(html).toContain('data-mode="view"');
    expect(html).toContain('class="block-columns block-columns-2"');
    expect(html).toContain('<h2 class="block-heading">문서 안내</h2>');
    expect(html.indexOf("둘째 값")).toBeLessThan(html.indexOf("첫 값"));
    expect(html).toContain("&lt;script&gt;안전한 설명&lt;/script&gt;");
    expect(html).toContain('class="block-pagebreak"');
    expect(html).not.toContain('class="label">첨부');
    expect(html).not.toMatch(/<(input|button|textarea)\b/);
  });

  it("blocks 없는 기존 양식은 필드 순서와 빈 값 표시를 유지한다", () => {
    const html = renderToStaticMarkup(
      createElement(FormValuesView, {
        schema,
        values: { first: "기존 값" },
        ctx: { members: [], departments: [] },
      }),
    );
    expect(html).toContain("legacy-fields");
    expect(html.indexOf("첫 항목")).toBeLessThan(html.indexOf("둘째 항목"));
    expect(html).toContain("기존 값");
    expect(html).toContain('text-muted-foreground">-</span>');
  });
});

import { buildPdfHtml, type PdfInput } from "@fmerp/shared/domain/document-print";
import { describe, expect, it } from "vitest";
import { previewOrientation } from "../src/service/print-preview";

/** previewOrientation이 읽는 select 체인만 흉내 낸 가짜 트랜잭션. layout 한 행을 돌려준다 */
function fakeTx(layout: Record<string, unknown> | null) {
  const rows = layout ? [{ layout }] : [];
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => Promise.resolve(rows),
  };
  return { select: () => chain } as never;
}

/** 미리보기는 완료 PDF와 같은 생성기를 쓴다. 여기서는 미리보기에만 중요한 두 가지를 검사한다 */
const base = (over: Partial<PdfInput> = {}): PdfInput => ({
  title: "출장 정산",
  docNo: "FM-GEN-2026-0001",
  businessName: "포엠테스트 본사",
  form: {
    name: "지출결의서",
    layout: {},
    schema: { fields: [{ key: "memo", label: "메모", type: "text" }] },
  },
  values: { memo: "보통 내용" },
  names: {},
  drafter: { membershipId: "m1", name: "홍길동", department: "총무", position: "과장" },
  approvers: [
    {
      stepId: "s1",
      type: "approve",
      label: "결재",
      name: "김부장",
      position: "부장",
      status: "PENDING",
      at: null,
      onBehalfOfName: null,
    },
  ],
  submittedAt: "2026-10-15T01:00:00.000Z",
  completedAt: null,
  contentHash: "abc123",
  attachments: [],
  ...over,
});

describe("출력 미리보기: 사용자 입력 이스케이프 회귀", () => {
  it("제목·양식 값의 HTML 특수문자와 스크립트 태그를 이스케이프한다", () => {
    const html = buildPdfHtml(
      base({
        title: '<script>alert("x")</script>',
        values: { memo: "<img src=x onerror=alert(1)>" },
      }),
    );
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x onerror");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("작성자·결재자 이름의 특수문자도 이스케이프한다", () => {
    const html = buildPdfHtml(
      base({
        drafter: { membershipId: "m1", name: "A&B <i>", department: null, position: null },
      }),
    );
    expect(html).toContain("A&amp;B &lt;i&gt;");
    expect(html).not.toContain("A&B <i>");
  });
});

describe("출력 미리보기: 방향 (X-Print-Orientation 헤더와 @page 일치)", () => {
  // 헤더 값은 service/print-preview.ts의 orientationOf가 정한다. 같은 규칙(landscape만 가로)을 쓰는 HTML의 @page와 맞는지 확인한다
  it("layout.orientation이 landscape면 @page가 A4 landscape다", () => {
    const form = base().form;
    const html = buildPdfHtml(base({ form: { ...form, layout: { orientation: "landscape" } } }));
    expect(html).toContain("@page { size: A4 landscape; }");
  });

  it("layout.orientation이 없거나 landscape가 아니면 @page가 A4 portrait다", () => {
    const form = base().form;
    expect(buildPdfHtml(base())).toContain("@page { size: A4 portrait; }");
    const html = buildPdfHtml(base({ form: { ...form, layout: { orientation: "sideways" } } }));
    expect(html).toContain("@page { size: A4 portrait; }");
  });

  it("previewOrientation은 layout.orientation landscape를 landscape로 알린다 (헤더 값)", async () => {
    expect(
      await previewOrientation({ tx: fakeTx({ orientation: "landscape" }) } as never, "d"),
    ).toBe("landscape");
  });

  it("previewOrientation은 layout이 없거나 landscape가 아니면 portrait로 알린다", async () => {
    expect(await previewOrientation({ tx: fakeTx({}) } as never, "d")).toBe("portrait");
    expect(
      await previewOrientation({ tx: fakeTx({ orientation: "sideways" }) } as never, "d"),
    ).toBe("portrait");
    expect(await previewOrientation({ tx: fakeTx(null) } as never, "d")).toBe("portrait");
  });
});

describe("출력 미리보기: 결재 진행 중 표시", () => {
  it("완료 전 문서에는 워터마크와 '결재 진행 중' 표시가 있다", () => {
    const html = buildPdfHtml(base({ completedAt: null }));
    expect(html).toContain('class="draft-watermark"');
    expect(html).toContain("결재 진행 중 (미완료)");
    expect(html).toContain("완료 결재 진행 중");
  });

  it("완료된 문서에는 워터마크가 없고 완료 시각을 표시한다", () => {
    const html = buildPdfHtml(base({ completedAt: "2026-10-15T05:00:00.000Z" }));
    expect(html).not.toContain("draft-watermark");
    expect(html).not.toContain("결재 진행 중");
    expect(html).toContain("완료");
  });
});

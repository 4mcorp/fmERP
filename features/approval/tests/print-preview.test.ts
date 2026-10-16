import { buildPdfHtml, type PdfInput } from "@fmerp/shared/domain/document-print";
import { describe, expect, it } from "vitest";

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

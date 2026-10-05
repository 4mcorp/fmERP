import { describe, expect, it } from "vitest";
import { buildPdfHtml, type PdfInput } from "./pdf-html";

const base = (): PdfInput => ({
  title: "출장 정산",
  docNo: "FM-GEN-2026-0001",
  businessName: "포엠테스트 본사",
  form: {
    name: "지출결의서",
    layout: {},
    schema: {
      fields: [
        { key: "memo", label: "메모", type: "text" },
        { key: "detail", label: "상세", type: "textarea" },
        { key: "amount", label: "금액", type: "money" },
        { key: "count", label: "건수", type: "number" },
        { key: "when", label: "일자", type: "date" },
        { key: "term", label: "기간", type: "daterange" },
        { key: "kind", label: "구분", type: "select", options: [{ value: "a", label: "교통비" }] },
        {
          key: "kinds",
          label: "복수",
          type: "multiselect",
          options: [
            { value: "x", label: "식비" },
            { value: "y", label: "숙박" },
          ],
        },
        { key: "who", label: "담당", type: "user" },
        { key: "body", label: "본문", type: "richtext" },
        {
          key: "rows",
          label: "내역",
          type: "table",
          columns: [
            { key: "item", label: "품목", type: "text" },
            { key: "price", label: "금액", type: "money", sum: true },
          ],
        },
      ],
    },
  },
  values: {
    memo: "서울 출장",
    detail: "첫 줄\n둘째 줄",
    amount: 1234567,
    count: 3,
    when: "2026-10-01",
    term: { from: "2026-10-01", to: "2026-10-03" },
    kind: "a",
    kinds: ["x", "y"],
    who: "m-9",
    body: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "제목" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "굵게", marks: [{ type: "bold" }] },
            { type: "text", text: " 일반" },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "항목1" }] }],
            },
          ],
        },
      ],
    },
    rows: [
      { item: "KTX", price: 59800 },
      { item: "택시", price: 12000 },
    ],
  },
  names: { "m-9": "구담당" },
  drafter: { membershipId: "m-1", name: "박사원", department: "재무팀", position: "사원" },
  approvers: [
    {
      stepId: "s-1",
      type: "approve",
      label: "결재",
      name: "최대리",
      position: "대리",
      status: "APPROVED",
      at: "2026-10-02T01:00:00.000Z",
      onBehalfOfName: null,
    },
    {
      stepId: "s-2",
      type: "approve",
      label: "결재",
      name: "대결자",
      position: "과장",
      status: "APPROVED",
      at: "2026-10-02T02:00:00.000Z",
      onBehalfOfName: "정팀장",
    },
  ],
  submittedAt: "2026-10-01T01:00:00.000Z",
  completedAt: "2026-10-02T02:00:00.000Z",
  contentHash: "c".repeat(64),
  attachments: [{ filename: "영수증.pdf", size: 2048 }],
});

describe("buildPdfHtml (APV-063)", () => {
  it("결재란은 쪽 경계에서 갈라지지 않는다", () => {
    const html = buildPdfHtml(base());
    expect(html).toMatch(/table\.approval \{[^}]*break-inside: avoid/);
    expect(html).toMatch(/\.bottom-box \{[^}]*break-inside: avoid/);
  });

  it("문서번호·제목·사업자·양식 이름을 머리에 둔다", () => {
    const html = buildPdfHtml(base());
    for (const text of ["FM-GEN-2026-0001", "출장 정산", "포엠테스트 본사", "지출결의서"]) {
      expect(html, text).toContain(text);
    }
    expect(html).toContain('lang="ko"');
  });

  it("결재란에 기안자와 결재자의 직위·성명·일시를 보인다 (KST)", () => {
    const html = buildPdfHtml(base());
    for (const text of ["박사원", "최대리", "대리", "10-02 10:00"]) {
      expect(html, text).toContain(text);
    }
  });

  it("대결은 원 결재자와 함께 표시한다", () => {
    const html = buildPdfHtml(base());
    expect(html).toContain("대결자");
    expect(html).toContain("정팀장");
    expect(html).toMatch(/대결/);
  });

  it("서명·도장 이미지가 있으면 그림을 넣고 없으면 성명을 쓴다", () => {
    const input = base();
    const first = input.approvers[0];
    if (first) input.approvers[0] = { ...first, signatureUri: "data:image/png;base64,AAAA" };
    const html = buildPdfHtml(input);
    expect(html).toContain('src="data:image/png;base64,AAAA"');
  });

  it("각 필드 유형을 사람이 읽는 값으로 바꾼다", () => {
    const html = buildPdfHtml(base());
    for (const text of [
      "서울 출장",
      "1,234,567원",
      "2026-10-01 ~ 2026-10-03",
      "교통비",
      "식비, 숙박",
      "구담당",
      "첫 줄<br>둘째 줄",
    ]) {
      expect(html, text).toContain(text);
    }
    expect(html).not.toContain("m-9");
  });

  it("표는 열 합계를 보이고 리치 텍스트는 서식을 HTML로 바꾼다", () => {
    const html = buildPdfHtml(base());
    expect(html).toContain("KTX");
    expect(html).toContain("71,800원");
    expect(html).toContain("<h2>제목</h2>");
    expect(html).toContain("<strong>굵게</strong>");
    expect(html).toContain("<li><p>항목1</p></li>");
  });

  it("첨부 목록과 상신 해시를 적는다", () => {
    const html = buildPdfHtml(base());
    expect(html).toContain("영수증.pdf");
    expect(html).toContain("2.0KB");
    expect(html).toContain("c".repeat(64));
  });

  it("사용자 입력은 모두 이스케이프한다 (XSS)", () => {
    const input = base();
    input.title = '<script>alert(1)</script>"><img src=x onerror=alert(2)>';
    input.values.memo = "<b onmouseover=alert(3)>x</b>";
    input.values.body = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "<iframe src=//evil></iframe>", marks: [{ type: "bold" }] },
          ],
        },
      ],
    };
    input.names["m-9"] = "<u>이름</u>";
    input.attachments = [{ filename: '"><script>x</script>.pdf', size: 1 }];
    const html = buildPdfHtml(input);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img src=x/i);
    expect(html).not.toMatch(/<iframe/i);
    expect(html).not.toContain("<b onmouseover");
    expect(html).not.toContain("<u>이름</u>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("알 수 없는 리치 텍스트 노드와 링크 마크는 글자만 남기고 위험한 주소는 쓰지 않는다", () => {
    const input = base();
    input.values.body = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "링크",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
        { type: "unknownNode", content: [{ type: "text", text: "남는 글자" }] },
      ],
    };
    const html = buildPdfHtml(input);
    expect(html).not.toContain("javascript:");
    expect(html).toContain("링크");
    expect(html).toContain("남는 글자");
  });

  it("양식 레이아웃으로 용지 방향과 결재란 위치를 정한다 (APV-007)", () => {
    const landscape = base();
    landscape.form.layout = { orientation: "landscape", approvalBoxPosition: "top-left" };
    const html = buildPdfHtml(landscape);
    expect(html).toContain("size: A4 landscape");
    expect(html).toContain("approval-left");
    expect(buildPdfHtml(base())).toContain("size: A4 portrait");
  });

  it("빈 값과 스키마에 없는 값은 건너뛴다", () => {
    const input = base();
    input.values = { extra: "숨겨진", memo: "" };
    const html = buildPdfHtml(input);
    expect(html).not.toContain("숨겨진");
  });

  it("글꼴 CSS를 넘기면 그대로 넣는다", () => {
    const input = base();
    input.fontCss = "@font-face{font-family:Pretendard;src:url(data:font/woff2;base64,AA)}";
    expect(buildPdfHtml(input)).toContain("font-family:Pretendard");
  });
});

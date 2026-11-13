import { describe, expect, it } from "vitest";
import { buildPdfHtml, type PdfInput } from "./document-print";

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

describe("buildPdfHtml 블록 배치", () => {
  it("블록 순서·설명·제목·구분선을 출력하며 필드 정의 순서를 강제하지 않는다", () => {
    const input = base();
    input.form.layout = {
      blocks: [
        { kind: "heading", level: 2, text: "안내 & 주의" },
        { kind: "text", text: '"설명"\n둘째 줄' },
        { kind: "divider" },
        ...input.form.schema.fields.toReversed().map(({ key }) => ({ kind: "field", key })),
      ],
    };
    const html = buildPdfHtml(input);
    expect(html).toContain('<h2 class="block-heading">안내 &amp; 주의</h2>');
    expect(html).toContain("&quot;설명&quot;\n둘째 줄");
    expect(html).toContain('<hr class="block-divider">');
    expect(html.indexOf('class="grid"')).toBeLessThan(html.indexOf("서울 출장"));
    expect(html).not.toContain('class="form-blocks fields legacy-fields"');
  });

  it("외부 JSON의 중복·누락·중첩·주입 블록을 출력 전에 거부한다", () => {
    for (const blocks of [
      [
        { kind: "field", key: "memo" },
        { kind: "field", key: "memo" },
      ],
      [{ kind: "heading", level: 1, text: "<img src=x onerror=alert(1)>" }],
      [{ kind: "columns", cols: [[{ kind: "columns", cols: [[], []] }], []] }],
      [{ kind: "mystery" }],
    ]) {
      const input = base();
      input.form.layout = { blocks };
      expect(() => buildPdfHtml(input)).toThrow("잘못된 양식 배치");
    }
  });
});

describe("buildPdfHtml (APV-063)", () => {
  it("리치 텍스트 표의 머리글, 행과 안전한 병합 속성을 PDF HTML에 보존한다", () => {
    const input = base();
    input.values.body = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  attrs: { colspan: 2 },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "<제목>" }] }],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { rowspan: 2, colspan: '1" onclick="alert(1)' },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "내용" }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const html = buildPdfHtml(input);
    expect(html).toContain(
      '<table class="rich-table"><tbody><tr><th colspan="2"><p>&lt;제목&gt;</p></th></tr>',
    );
    expect(html).toContain('<td rowspan="2"><p>내용</p></td>');
    expect(html).not.toContain("onclick=");
  });
  it("PDF 표에 병합 셀의 검증된 열 너비를 보존한다", () => {
    const input = base();
    input.values.body = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 2, colwidth: [120, 240] },
                  content: [{ type: "paragraph" }],
                },
                {
                  type: "tableCell",
                  attrs: { colwidth: ["1; color:red"] },
                  content: [{ type: "paragraph" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const html = buildPdfHtml(input);
    expect(html).toContain(
      '<colgroup><col style="width:120px"><col style="width:240px"><col></colgroup>',
    );
    expect(html).not.toContain("color:red");
  });
  it("PDF에서 허용 상한의 병합 셀을 유지한다", () => {
    const input = base();
    input.values.body = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 100, rowspan: 100 },
                  content: [{ type: "paragraph" }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(buildPdfHtml(input)).toContain('<td colspan="100" rowspan="100"><p></p></td>');
  });
  it("결재란은 쪽 경계에서 갈라지지 않는다", () => {
    const html = buildPdfHtml(base());
    expect(html).toMatch(/table\.approval \{[^}]*break-inside: avoid/);
    expect(html).toMatch(/\.bottom-box \{[^}]*break-inside: avoid/);
  });

  it("결재란은 3·8·15칸 기준으로 한두 줄에 나누고 폭·글자 크기를 자동 맞춤한다", () => {
    for (const maxCells of [3, 8, 15]) {
      const input = base();
      input.approvalLineMaxCells = maxCells;
      input.approvers = Array.from({ length: maxCells - 1 }, (_, i) => ({
        stepId: `s-${i}`,
        type: "approve",
        label: "결재",
        name: `결재자${i}`,
        position: null,
        status: "PENDING",
        at: null,
        onBehalfOfName: null,
      }));
      const html = buildPdfHtml(input);
      expect(html).toContain("--cell-width:20mm");
      expect(html).toContain("--cell-font:");
      const approvalRows = html
        .match(/<table class="approval"[^>]*>(.*?)<\/table>/s)?.[1]
        ?.match(/<tr>/g);
      expect(approvalRows?.length).toBe(maxCells <= 2 ? 1 : 2);
      expect(html).toContain(`결재자${maxCells - 2}`);
    }
  });

  it("결재란 칸 폭은 11~20mm 범위로 자동 계산한다 (2·15칸 20mm, 20칸 18.6mm, 30칸 12.4mm)", () => {
    const widths: Record<number, string> = {
      2: "20mm",
      15: "20mm",
      20: "18.6mm",
      30: "12.4mm",
    };
    for (const [maxCells, width] of Object.entries(widths)) {
      const input = base();
      input.approvalLineMaxCells = Number(maxCells);
      const html = buildPdfHtml(input);
      expect(html, `maxCells=${maxCells}`).toContain(`--cell-width:${width}`);
    }
  });

  it("결재란은 설정된 최대 칸을 넘어도 결재자를 누락하지 않는다", () => {
    const input = base();
    input.approvalLineMaxCells = 3;
    input.approvers = Array.from({ length: 15 }, (_, i) => ({
      stepId: `s-${i}`,
      type: "approve",
      label: "결재",
      name: `결재자${i}`,
      position: null,
      status: "PENDING",
      at: null,
      onBehalfOfName: null,
    }));
    const html = buildPdfHtml(input);
    expect(html).toContain("결재자14");
    expect(html.match(/<td class="cell"/g)).toHaveLength(16);
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

  it("한 줄 텍스트 필드의 줄바꿈을 <br>로 바꾼다 (R5)", () => {
    const input = base();
    input.values.memo = "첫 줄\n둘째 줄";
    const html = buildPdfHtml(input);
    expect(html).toContain("첫 줄<br>둘째 줄");
  });

  it("리치 텍스트 텍스트 노드의 줄바꿈을 <br>로 바꾼다 (R5)", () => {
    const input = base();
    input.values.body = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "가\n나" }] }],
    };
    const html = buildPdfHtml(input);
    expect(html).toContain("<p>가<br>나</p>");
  });

  it("본문 여백·표·필드 박스 폭 규칙을 CSS에 둔다 (R4)", () => {
    const html = buildPdfHtml(base());
    expect(html).toMatch(/body \{[^}]*padding: 0 0\.6mm/);
    expect(html).toMatch(/\.fields \{[^}]*width: 100%[^}]*box-sizing: border-box/);
    expect(html).toMatch(/table\.grid \{[^}]*width: 100%[^}]*box-sizing: border-box/);
    expect(html).toMatch(/\.field \.value \{[^}]*white-space: pre-wrap/);
  });
});

it("preserves deeply nested legacy text in PDF", () => {
  const input = base();
  let node: { type: string; content: unknown[] } = {
    type: "paragraph",
    content: [{ type: "text", text: "깊은 원문" }],
  };
  for (let i = 0; i < 600; i++) node = { type: "blockquote", content: [node] };
  input.values.body = { type: "doc", content: [node] };
  expect(buildPdfHtml(input)).toContain("깊은 원문");
});

it("preserves wide legacy content under the original size limit", () => {
  const input = base();
  input.values.body = {
    type: "doc",
    content: [...Array.from({ length: 10001 }, () => ({})), { type: "text", text: "끝" }],
  };
  expect(buildPdfHtml(input)).toContain("끝");
});

it("fails explicitly rather than truncating excessive or cyclic PDF content", () => {
  const input = base();
  const node: { type: string; content: unknown[] } = { type: "doc", content: [] };
  node.content.push(node);
  input.values.body = node;
  expect(() => buildPdfHtml(input)).toThrow(/PDF 리치텍스트/);
  input.values.body = {
    type: "doc",
    content: Array.from({ length: 100001 }, () => ({ type: "text", text: "x" })),
  };
  expect(() => buildPdfHtml(input)).toThrow(/PDF 리치텍스트/);
});

it("prints text attached to unsupported legacy nodes", () => {
  const input = base();
  input.values.body = { type: "doc", content: [{ type: "legacyWidget", text: "과거 위젯 원문" }] };
  expect(buildPdfHtml(input)).toContain("과거 위젯 원문");
});

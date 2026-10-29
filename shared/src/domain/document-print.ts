// 결재 완료 PDF용 HTML (PRD APV-063·APV-007). 순수 함수이며 사용자 입력은 모두 이스케이프한다.
// 실제 PDF 변환(Playwright)은 worker가 이 HTML을 받아 한다.

import type { PersonCard } from "./completion-package";
import { type FormField, type FormSchema, formatPerson, type PersonInfo } from "./form-schema";
import { tableSums } from "./form-values";

export interface PdfApprover {
  stepId: string;
  type: string;
  /** 결재란 머리글: 결재·합의·협조·감사·후결 */
  label: string;
  name: string;
  position?: string | null;
  status: string;
  /** 처리 일시 (ISO). 처리 전이면 null */
  at: string | null;
  /** 대결로 처리했으면 원 결재자 이름 */
  onBehalfOfName: string | null;
  /** 서명·도장 이미지 (data URI) */
  signatureUri?: string | null;
  stampUri?: string | null;
}

export interface PdfInput {
  title: string;
  docNo: string | null;
  businessName: string;
  /** 사업자 직인 (data URI) */
  sealUri?: string | null;
  form: { name: string; schema: FormSchema; layout: Record<string, unknown> };
  values: Record<string, unknown>;
  /** 구성원·부서 id → 이름 (user·dept 필드 표시용) */
  names: Record<string, string>;
  /** 구성원 id → 완료 시점의 이름·메일·사번 (user 필드 표시 방식용). 없으면 names의 이름을 쓴다 */
  people?: Record<string, PersonInfo>;
  drafter: PersonCard & { signatureUri?: string | null; stampUri?: string | null };
  approvers: PdfApprover[];
  submittedAt: string | null;
  completedAt: string | null;
  contentHash: string | null;
  attachments: { filename: string; size: number }[];
  /** `@font-face` CSS (worker가 Pretendard 파일을 담아 넘긴다) */
  fontCss?: string;
  /** 기안 칸을 포함한 결재란 최대 칸 수 (2~30, 기본 15) */
  approvalLineMaxCells?: number;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** ISO 시각을 서울 시간 `MM-DD HH:mm`로 */
function kst(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 9 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function kstFull(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 9 * 3_600_000);
  return `${d.getUTCFullYear()}-${kst(iso)}`;
}

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** data URI 이미지만 허용한다 (외부 주소를 불러오지 않는다) */
const safeImage = (uri?: string | null) =>
  uri && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(uri) ? uri : null;

// ===== 리치 텍스트 (tiptap JSON) =====
interface RichNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  content?: RichNode[];
}

const safeHref = (href: unknown) =>
  typeof href === "string" && /^(https?:|mailto:)/i.test(href) ? href : null;

function renderMarks(text: string, marks: RichNode["marks"]): string {
  let out = esc(text).replace(/\r?\n/g, "<br>");
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case "bold":
        out = `<strong>${out}</strong>`;
        break;
      case "italic":
        out = `<em>${out}</em>`;
        break;
      case "underline":
        out = `<u>${out}</u>`;
        break;
      case "strike":
        out = `<s>${out}</s>`;
        break;
      case "code":
        out = `<code>${out}</code>`;
        break;
      case "link": {
        const href = safeHref(mark.attrs?.href);
        if (href) out = `<a href="${esc(href)}">${out}</a>`;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function renderRich(node: RichNode | undefined): string {
  if (!node || typeof node !== "object") return "";
  const children = (node.content ?? []).map(renderRich).join("");
  switch (node.type) {
    case "doc":
      return children;
    case "text":
      return renderMarks(node.text ?? "", node.marks);
    case "paragraph":
      return `<p>${children}</p>`;
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
      return `<h${level}>${children}</h${level}>`;
    }
    case "bulletList":
      return `<ul>${children}</ul>`;
    case "orderedList":
      return `<ol>${children}</ol>`;
    case "listItem":
      return `<li>${children}</li>`;
    case "blockquote":
      return `<blockquote>${children}</blockquote>`;
    case "codeBlock":
      return `<pre>${children}</pre>`;
    case "hardBreak":
      return "<br>";
    case "horizontalRule":
      return "<hr>";
    default:
      // 알 수 없는 노드는 태그 없이 안의 글자만 남긴다
      return children;
  }
}

// ===== 필드 값 =====
const isBlank = (v: unknown) =>
  v === undefined ||
  v === null ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0);

function refNames(value: unknown, names: Record<string, string>): string {
  const ids = Array.isArray(value) ? value : [value];
  return ids
    .filter((v): v is string => typeof v === "string")
    .map((id) => names[id] ?? "(알 수 없음)")
    .join(", ");
}

function userNames(value: unknown, display: Parameters<typeof formatPerson>[0], input: PdfInput) {
  const ids = Array.isArray(value) ? value : [value];
  return ids
    .filter((v): v is string => typeof v === "string")
    .map((id) => {
      const person = input.people?.[id];
      return person ? formatPerson(display, person) : (input.names[id] ?? "(알 수 없음)");
    })
    .join(", ");
}

function renderTable(
  field: Extract<FormField, { type: "table" }>,
  value: unknown,
  sums: Record<string, number> | undefined,
): string {
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const cell = (col: (typeof field.columns)[number], v: unknown) => {
    if (v === undefined || v === null || v === "") return "";
    if (col.type === "money" && typeof v === "number") return won(v);
    if (col.type === "number" && typeof v === "number") return v.toLocaleString("ko-KR");
    return esc(v);
  };
  const head = field.columns.map((c) => `<th>${esc(c.label)}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${field.columns
          .map(
            (c) =>
              `<td class="${c.type === "money" || c.type === "number" ? "num" : ""}">${cell(c, row?.[c.key])}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  const foot = sums
    ? `<tr class="sum">${field.columns
        .map((c, i) => {
          if (sums[c.key] === undefined) return `<td>${i === 0 ? "합계" : ""}</td>`;
          const total = sums[c.key] as number;
          return `<td class="num">${c.type === "money" ? won(total) : total.toLocaleString("ko-KR")}</td>`;
        })
        .join("")}</tr>`
    : "";
  return `<table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}${foot}</tbody></table>`;
}

function renderField(
  field: FormField,
  input: PdfInput,
  sums: Record<string, Record<string, number>>,
): string {
  const value = input.values[field.key];
  if (field.type === "attachment" || isBlank(value)) return "";
  let html: string;
  switch (field.type) {
    case "text":
      html = esc(value).replace(/\r?\n/g, "<br>");
      break;
    case "textarea":
      html = esc(value).replace(/\r?\n/g, "<br>");
      break;
    case "money":
      html = typeof value === "number" ? won(value) : esc(value);
      break;
    case "number":
      html = typeof value === "number" ? value.toLocaleString("ko-KR") : esc(value);
      break;
    case "date":
      html = esc(value);
      break;
    case "daterange": {
      const r = value as { from?: string; to?: string };
      html = `${esc(r.from)} ~ ${esc(r.to)}`;
      break;
    }
    case "select":
      html = esc(field.options.find((o) => o.value === value)?.label ?? "");
      break;
    case "multiselect":
      html = esc(
        (Array.isArray(value) ? value : [])
          .map((v) => field.options.find((o) => o.value === v)?.label)
          .filter(Boolean)
          .join(", "),
      );
      break;
    case "user":
      html = esc(userNames(value, field.display, input));
      break;
    case "dept":
      html = esc(refNames(value, input.names));
      break;
    case "table":
      return `<div class="field wide"><div class="label">${esc(field.label)}</div>${renderTable(field, value, sums[field.key])}</div>`;
    case "richtext":
      return `<div class="field wide"><div class="label">${esc(field.label)}</div><div class="rich">${renderRich(value as RichNode)}</div></div>`;
    default:
      return "";
  }
  return `<div class="field"><div class="label">${esc(field.label)}</div><div class="value">${html}</div></div>`;
}

// ===== 결재란 =====
function signCell(
  name: string,
  position: string | null | undefined,
  label: string,
  at: string | null,
  onBehalf: string | null,
  images: { signatureUri?: string | null; stampUri?: string | null },
  done: boolean,
): string {
  const sig = safeImage(images.signatureUri);
  const stamp = safeImage(images.stampUri);
  const mark = onBehalf ? `<div class="behalf">대결</div>` : "";
  let body: string;
  if (!done) body = `<div class="pending">대기</div>`;
  else if (sig || stamp) {
    body = `${sig ? `<img class="sig" src="${sig}" alt="">` : ""}${stamp ? `<img class="stamp" src="${stamp}" alt="">` : ""}`;
  } else {
    body = `<div class="signed-name">${esc(name)}</div>`;
  }
  const who = onBehalf ? `${esc(name)}<br><span class="sub">(${esc(onBehalf)})</span>` : esc(name);
  return `<td class="cell"><div class="head">${esc(label)}${position ? `<br><span class="sub">${esc(position)}</span>` : ""}</div><div class="body">${body}${mark}</div><div class="who">${who}</div><div class="when">${done ? esc(kst(at)) : ""}</div></td>`;
}

function approvalBox(input: PdfInput): string {
  const drafter = signCell(
    input.drafter.name,
    input.drafter.position,
    "기안",
    input.submittedAt,
    null,
    input.drafter,
    true,
  );
  const cells = input.approvers.map((a) =>
    signCell(
      a.name,
      a.position,
      a.label,
      a.at,
      a.onBehalfOfName,
      a,
      a.status === "APPROVED" || a.status === "POST_APPROVED" || a.status === "SKIPPED",
    ),
  );
  const maxCells = Math.min(30, Math.max(2, Math.floor(input.approvalLineMaxCells ?? 15)));
  const rowCapacity = Math.ceil(maxCells / 2);
  const firstRow = [drafter, ...cells.slice(0, rowCapacity - 1)];
  const secondRow = cells.slice(rowCapacity - 1, Math.min(cells.length, maxCells - 1));
  const extraRows = cells.slice(maxCells - 1);
  const rows = [firstRow, secondRow, ...extraRows.map((cell) => [cell])].filter(
    (row) => row.length > 0,
  );
  const cellWidth = Math.min(20, Math.max(11, (210 - 24) / rowCapacity));
  const cellFont = Math.min(8.5, Math.max(7, (8.5 * cellWidth) / 24));
  const cellImageWidth = Math.min(20, cellWidth * 0.85);
  return `<table class="approval" style="--cell-width:${cellWidth}mm;--cell-font:${cellFont}pt;--cell-image-width:${cellImageWidth}mm">${rows.map((row) => `<tr>${row.join("")}</tr>`).join("")}</table>`;
}

const CSS = `
  @page { margin: 14mm 12mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Pretendard", "Noto Sans CJK KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; font-size: 10.5pt; color: #111; line-height: 1.5; margin: 0; padding: 0 0.6mm; }
  h1.title { font-size: 20pt; text-align: center; margin: 4mm 0 6mm; }
  .meta { display: flex; justify-content: space-between; font-size: 9.5pt; color: #333; margin-bottom: 4mm; }
  .top { display: flex; margin-bottom: 4mm; }
  .top.approval-right { justify-content: flex-end; }
  .top.approval-left { justify-content: flex-start; }
  .top.approval-bottom { display: none; }
  .bottom-box { display: none; margin-top: 8mm; break-inside: avoid; }
  .bottom-box.show { display: flex; justify-content: flex-end; }
  table.approval { border-collapse: collapse; break-inside: avoid; table-layout: fixed; }
  table.approval tr, table.approval td.cell { break-inside: avoid; }
  table.approval td.cell { border: 1px solid #333; width: var(--cell-width); text-align: center; vertical-align: top; padding: 0; font-size: var(--cell-font); }
  .cell .head { background: #f1f1f1; border-bottom: 1px solid #333; font-size: inherit; padding: 1mm; min-height: 9mm; }
  .cell .body { height: 15mm; position: relative; display: flex; align-items: center; justify-content: center; }
  .cell .body img.sig, .cell .body img.stamp { max-height: 13mm; max-width: var(--cell-image-width); }
  .cell .body img.stamp { position: absolute; right: 1mm; top: 1mm; max-height: 11mm; opacity: 0.9; }
  .cell .signed-name { font-weight: 600; }
  .cell .pending { color: #999; font-size: inherit; }
  .cell .behalf { position: absolute; left: 1mm; top: 1mm; border: 1px solid #c00; color: #c00; font-size: 7pt; padding: 0 1mm; border-radius: 1mm; }
  .cell .who { font-size: 8.5pt; border-top: 1px solid #ccc; padding: 0.5mm; }
  .cell .when { font-size: 7.5pt; color: #444; padding-bottom: 0.5mm; min-height: 4mm; }
  .sub { font-size: 7.5pt; color: #555; font-weight: 400; }
  .fields { display: flex; flex-wrap: wrap; border-top: 1px solid #333; width: 100%; box-sizing: border-box; }
  .field { width: 50%; display: flex; border-bottom: 1px solid #ccc; }
  .field:not(.wide) { border-right: 1px solid #ccc; }
  .field.wide { width: 100%; display: block; }
  .field .label { width: 30mm; background: #f6f6f6; padding: 1.5mm 2mm; font-weight: 600; font-size: 9.5pt; border-right: 1px solid #ddd; flex-shrink: 0; }
  .field.wide .label { width: 100%; border-right: none; border-bottom: 1px solid #ddd; }
  .field .value { padding: 1.5mm 2mm; flex: 1; word-break: break-word; white-space: pre-wrap; }
  .rich { padding: 2mm; }
  .rich p { margin: 0 0 2mm; } .rich h1, .rich h2, .rich h3 { margin: 3mm 0 2mm; }
  .rich ul, .rich ol { margin: 0 0 2mm 5mm; padding: 0; } .rich blockquote { border-left: 2px solid #bbb; margin: 0 0 2mm; padding-left: 3mm; color: #444; }
  .rich pre, .rich code { font-family: monospace; background: #f3f3f3; }
  table.grid { width: 100%; box-sizing: border-box; border-collapse: collapse; }
  table.grid th, table.grid td { border: 1px solid #bbb; padding: 1mm 2mm; font-size: 9.5pt; }
  table.grid th { background: #f1f1f1; } table.grid td.num { text-align: right; }
  table.grid tr.sum td { font-weight: 700; background: #fafafa; }
  .attach { margin-top: 5mm; font-size: 9.5pt; } .attach h3 { font-size: 10pt; margin: 0 0 1mm; }
  .attach ul { margin: 0; padding-left: 5mm; }
  .footer { margin-top: 8mm; font-size: 8pt; color: #555; border-top: 1px solid #ccc; padding-top: 2mm; word-break: break-all; }
  .seal { position: absolute; right: 12mm; top: 6mm; max-height: 20mm; opacity: 0.85; }
`;

/** 결재가 끝나지 않은 문서의 출력 미리보기에만 넣는 워터마크·스타일 (계획 2.3) */
const DRAFT_WATERMARK_CSS = `
  .draft-watermark { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 46pt; font-weight: 700; color: rgba(200, 0, 0, 0.12); transform: rotate(-20deg); pointer-events: none; }
`;

const POSITIONS = new Set(["top-right", "top-left", "bottom"]);

export function buildPdfHtml(input: PdfInput): string {
  const layout = input.form.layout ?? {};
  const orientation = layout.orientation === "landscape" ? "landscape" : "portrait";
  const rawPos = layout.approvalBoxPosition;
  const position = typeof rawPos === "string" && POSITIONS.has(rawPos) ? rawPos : "top-right";
  const topClass =
    position === "top-left"
      ? "approval-left"
      : position === "bottom"
        ? "approval-bottom"
        : "approval-right";
  const sums = tableSums(input.form.schema, input.values);
  const fields = input.form.schema.fields.map((f) => renderField(f, input, sums)).join("");
  const seal = safeImage(input.sealUri);
  const attachments =
    input.attachments.length > 0
      ? `<div class="attach"><h3>첨부 파일</h3><ul>${input.attachments
          .map((a) => `<li>${esc(a.filename)} (${size(a.size)})</li>`)
          .join("")}</ul></div>`
      : "";
  const box = approvalBox(input);
  const completed = input.completedAt !== null;
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${esc(input.title)}</title>
<style>${input.fontCss ?? ""}
@page { size: A4 ${orientation}; }
${CSS}${completed ? "" : DRAFT_WATERMARK_CSS}</style></head>
<body>
${completed ? "" : `<div class="draft-watermark">결재 진행 중 (미완료)</div>`}
${seal ? `<img class="seal" src="${seal}" alt="">` : ""}
<h1 class="title">${esc(input.title)}</h1>
<div class="meta"><span>${esc(input.businessName)} · ${esc(input.form.name)}</span><span>문서번호 ${esc(input.docNo ?? "-")}</span></div>
<div class="top ${topClass}">${box}</div>
<div class="fields">${fields}</div>
${attachments}
<div class="bottom-box ${position === "bottom" ? "show" : ""}">${position === "bottom" ? box : ""}</div>
<div class="footer">상신 ${esc(kstFull(input.submittedAt))} · 완료 ${completed ? esc(kstFull(input.completedAt)) : "결재 진행 중"}<br>상신 시점 내용 해시(SHA-256): ${esc(input.contentHash ?? "-")}</div>
</body></html>`;
}

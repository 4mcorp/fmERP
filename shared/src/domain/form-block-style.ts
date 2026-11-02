/** 웹과 PDF가 같은 배치 규칙을 쓴다. 글꼴은 worker의 data URI 또는 웹의 동일 woff2다. */
export const FORM_BLOCK_FONT_CSS = `
  @font-face { font-family: "Pretendard"; font-style: normal; font-weight: 400; font-display: block; src: url("/fonts/Pretendard-Regular.woff2") format("woff2"); }
  @font-face { font-family: "Pretendard"; font-style: normal; font-weight: 700; font-display: block; src: url("/fonts/Pretendard-Bold.woff2") format("woff2"); }
`;

export const FORM_BLOCK_CSS = `
  .form-blocks.fields { display: flex; flex-wrap: wrap; border-top: 1px solid #333; width: 100%; box-sizing: border-box; }
  .form-blocks .field { width: 50%; display: flex; border-bottom: 1px solid #ccc; }
  .form-blocks .field:not(.wide) { border-right: 1px solid #ccc; }
  .form-blocks .field.wide { width: 100%; display: block; }
  .form-blocks .field .label { width: 30mm; background: #f6f6f6; padding: 1.5mm 2mm; font-weight: 600; font-size: 9.5pt; border-right: 1px solid #ddd; flex-shrink: 0; }
  .form-blocks .field.wide .label { width: 100%; border-right: none; border-bottom: 1px solid #ddd; }
  .form-blocks .field .value { padding: 1.5mm 2mm; flex: 1; word-break: break-word; white-space: pre-wrap; }
  .form-blocks .rich { padding: 2mm; }
  .form-blocks .rich p { margin: 0 0 2mm; }
  .form-blocks .rich h1, .form-blocks .rich h2, .form-blocks .rich h3 { margin: 3mm 0 2mm; font-weight: 700; }
  .form-blocks .rich h1 { font-size: 2em; }
  .form-blocks .rich h2 { font-size: 1.5em; }
  .form-blocks .rich h3 { font-size: 1.17em; }
  .form-blocks .rich ul { list-style: disc; }
  .form-blocks .rich ol { list-style: decimal; }
  .form-blocks .rich ul, .form-blocks .rich ol { margin: 0 0 2mm 5mm; padding: 0; }
  .form-blocks .rich blockquote { border-left: 2px solid #bbb; margin: 0 0 2mm; padding-left: 3mm; color: #444; }
  .form-blocks .rich pre, .form-blocks .rich code { font-family: monospace; background: #f3f3f3; }
  .form-blocks table.grid { width: 100%; box-sizing: border-box; border-collapse: collapse; }
  .form-blocks table.grid th, .form-blocks table.grid td { border: 1px solid #bbb; padding: 1mm 2mm; font-size: 9.5pt; }
  .form-blocks table.grid th { background: #f1f1f1; font-weight: 700; text-align: center; }
  .form-blocks table.grid td.num { text-align: right; }
  .form-blocks table.grid tr.sum td { font-weight: 700; background: #fafafa; }

  .form-blocks { font-family: "Pretendard", sans-serif; color: #111; background: #fff; color-scheme: light; font-size: 10.5pt; font-weight: 400; line-height: 1.5; }
  .form-blocks, .form-block-options { --background:#fff; --foreground:#111; --muted:#f6f6f6; --muted-foreground:#555; --input:#ccc; --border:#ccc; --popover:#fff; --popover-foreground:#111; --accent:#eee; --accent-foreground:#111; color-scheme:light; }
  .form-blocks .value { min-width: 0; }
  .form-blocks .label > label { font: inherit; }
  .form-blocks[data-mode="fill"] [data-slot="select-trigger"] { width: 100%; max-width: 16rem; }
  .form-blocks, .form-blocks * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .form-blocks:not(.legacy-fields) { display: block; }
  .form-blocks:not(.legacy-fields) .field { width: 100%; }
  .form-blocks .field { min-width: 0; break-inside: avoid; }
  .form-blocks .field.wide { break-inside: auto; }
  .form-blocks .field.wide > .label { break-after: avoid; }
  .form-blocks .rich p, .form-blocks .rich li, .form-blocks .rich blockquote, .form-blocks table.grid tr { break-inside: avoid; }
  .form-blocks .rich h1, .form-blocks .rich h2, .form-blocks .rich h3 { break-after: avoid; }
  .form-blocks table.grid thead { display: table-header-group; }
  .form-blocks .block-heading { margin: 3mm 0 2mm; font-weight: 700; break-after: avoid; overflow-wrap: anywhere; }
  .form-blocks h1.block-heading { font-size: 16pt; }
  .form-blocks h2.block-heading { font-size: 13pt; }
  .form-blocks .block-text { margin: 2mm 0; white-space: pre-wrap; overflow-wrap: anywhere; orphans: 2; widows: 2; }
  .form-blocks .block-divider { border: 0; border-top: 1px solid #ccc; margin: 3mm 0; }
  .form-blocks .block-columns-scroll { position: relative; overflow-x: auto; }
  .form-blocks .block-columns { display: grid; gap: 3mm; min-width: 160mm; }
  .form-blocks .block-columns-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .form-blocks .block-columns-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .form-blocks .block-columns-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .form-blocks .block-column { min-width: 0; }
  .form-blocks .block-column .field { width: 100%; }
  .form-blocks .field.wide { overflow-x: auto; }
  .form-blocks .block-pagebreak { border-bottom: 1px dashed #999; color: #666; font-size: 9pt; text-align: center; margin: 3mm 0; }
  @media screen and (max-width: 640px) {
    .form-blocks.legacy-fields > .field { width: 100%; }
  }
  @media print {
    .form-blocks .block-columns-scroll, .form-blocks .field.wide { overflow: visible; }
    .form-blocks .block-columns { min-width: 0; }
    .form-blocks .block-pagebreak { break-after: page; height: 0; margin: 0; border: 0; font-size: 0; }
  }
`;

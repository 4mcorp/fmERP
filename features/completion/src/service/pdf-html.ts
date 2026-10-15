// 생성부는 shared/domain/document-print로 옮겼다(R6·R10이 기능 간 import 없이 재사용). 기존 import 경로 유지용 re-export.
export { buildPdfHtml, type PdfApprover, type PdfInput } from "@fmerp/shared/domain/document-print";

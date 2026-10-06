// 문서 목록 내보내기 (PRD APV-083): CSV·엑셀. 열람 권한 안의 문서만 담고, 내보낸 사실은 감사 로그에 남긴다.
import { recordAudit } from "@fmerp/audit";
import type { Actor } from "@fmerp/shared/domain/permissions";
import type { ServiceContext } from "@fmerp/shared/server/context";
import { ServiceError } from "@fmerp/shared/server/errors";
import writeXlsxFile from "write-excel-file/node";
import type { MailboxItem } from "./mailbox";
import { type SearchInput, searchDocuments } from "./search";

/** 한 번에 내보낼 수 있는 최대 행 수. 넘으면 조건을 좁히게 한다 */
const EXPORT_LIMIT = 10_000;
const PAGE = 100;

export type ExportFormat = "csv" | "xlsx";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "임시저장",
  IN_PROGRESS: "진행 중",
  ON_HOLD: "보류",
  WITHDRAWN: "회수",
  REJECTED: "반려",
  COMPLETED: "완료",
  CANCELED: "취소",
  ARCHIVED: "보관",
};
const SECURITY_LABEL: Record<string, string> = {
  normal: "일반",
  confidential: "대외비",
  secret: "비밀",
};

const HEADERS = [
  "문서번호",
  "제목",
  "기안자",
  "상태",
  "긴급",
  "보안등급",
  "상신일시",
  "완료일시",
] as const;

/** 서울 시간 `YYYY-MM-DD HH:mm` */
function kst(date: Date | null): string {
  if (!date) return "";
  const d = new Date(date.getTime() + 9 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function rowOf(d: MailboxItem): string[] {
  return [
    d.docNo ?? "",
    d.title,
    d.drafterName,
    STATUS_LABEL[d.status] ?? d.status,
    d.urgent ? "긴급" : "",
    SECURITY_LABEL[d.securityLevel] ?? d.securityLevel,
    kst(d.submittedAt),
    kst(d.completedAt),
  ];
}

/**
 * CSV 한 칸. 엑셀이 수식으로 실행할 수 있는 시작 글자(`= + - @`, 탭, 줄바꿈)는 앞에 `'`를 붙여 글자로 만들고
 * (수식 주입 방어), 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싼다.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(rows: string[][]): string {
  // Excel이 한글을 깨뜨리지 않도록 UTF-8 BOM을 붙인다
  return `﻿${[HEADERS as readonly string[], ...rows]
    .map((r) => r.map(csvCell).join(","))
    .join("\r\n")}\r\n`;
}

/** 검색 조건에 맞는 문서를 모아 CSV·엑셀로 만든다. EXPORT_LIMIT건을 넘으면 거부한다 */
export async function exportDocuments(
  ctx: ServiceContext,
  viewer: { membershipId: string; actor: Actor },
  input: Omit<SearchInput, "limit" | "cursor">,
  format: ExportFormat,
): Promise<{ filename: string; contentType: string; body: Uint8Array }> {
  const items: MailboxItem[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 2000; guard++) {
    const page = await searchDocuments(ctx, viewer, { ...input, limit: PAGE, cursor });
    items.push(...page.items);
    if (items.length > EXPORT_LIMIT) {
      throw new ServiceError(
        "validation_failed",
        `내보낼 문서가 ${EXPORT_LIMIT.toLocaleString("ko-KR")}건을 넘습니다. 기간·상태 같은 조건으로 줄여서 다시 시도하세요`,
      );
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  const rows = items.map(rowOf);
  const stamp = kst(ctx.now).replace(/[-: ]/g, "").slice(0, 12);
  let body: Uint8Array;
  let contentType: string;
  if (format === "csv") {
    body = new TextEncoder().encode(toCsv(rows));
    contentType = "text/csv; charset=utf-8";
  } else {
    // 문자열 칸은 수식으로 해석되지 않는다 (수식은 type: "Formula"로 명시해야만 쓰인다)
    const sheet = [
      HEADERS.map((h) => ({ value: h, fontWeight: "bold" as const })),
      ...rows.map((r) => r.map((v) => ({ value: v }))),
    ];
    body = new Uint8Array(
      await writeXlsxFile(sheet, {
        columns: [{ width: 22 }, { width: 40 }, { width: 12 }],
      }).toBuffer(),
    );
    contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  // 어떤 조건으로 몇 건을 내보냈는지 남긴다. 검색어 같은 값 자체는 남기지 않는다
  const used = Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
    .map(([k]) => k);
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "document.export",
    result: "success",
    reason: `${format.toUpperCase()} ${rows.length}건 (조건: ${used.length > 0 ? used.join(", ") : "없음"})`,
    request: ctx.request,
  });
  return { filename: `문서목록_${stamp}.${format}`, contentType, body };
}

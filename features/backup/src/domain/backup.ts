// 덤프·내보내기의 순수 규칙 (PRD BAK-005·009, M7 plan). DB·S3·프레임워크를 import하지 않는다.
import { canonicalJson } from "@fmerp/shared/domain/completion-package";

// ===== 백업 상태 (BAK-005: 매일 03:00 KST 실행, 03:30까지 성공 신호가 없으면 누락) =====
const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 24 * 3_600_000;
/** 자동 덤프 시작 시각과 성공 신호 기한 (한국 시간, 자정부터의 분) */
export const DUMP_START_MINUTES = 3 * 60;
export const DUMP_DEADLINE_MINUTES = 3 * 60 + 30;

export interface BackupRecord {
  status: string;
  kind: string;
  finishedAt: Date | null;
}

export interface BackupHealth {
  state: "ok" | "overdue";
  /** 마지막 성공 신호(SUCCEEDED·SKIPPED)의 끝난 시각. 없으면 null */
  lastSuccessAt: Date | null;
  /** 가장 최근에 지난(또는 지금 진행 중인) 기한. 이 기한 전에 성공 신호가 있었어야 한다 */
  expectedBy: Date;
}

/** `ms`가 속한 한국 날짜의 자정(KST)을 UTC 시각으로 */
function kstMidnight(ms: number): number {
  return Math.floor((ms + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS;
}

/**
 * 자동·수동 덤프 이력으로 백업 상태를 판정한다. 가장 최근에 지난 03:30 KST 기한을 구하고,
 * 그 기한의 실행 시작(03:00) 이후에 끝난 성공 신호(건너뜀 포함, 수동 덤프 포함)가 있으면 정상이다.
 * 알림 발송은 M8이 이 함수를 쓴다.
 */
export function backupHealth(now: Date, records: BackupRecord[]): BackupHealth {
  const midnight = kstMidnight(now.getTime());
  let deadline = midnight + DUMP_DEADLINE_MINUTES * 60_000;
  // 오늘 기한 전이면 어제 기한이 "가장 최근에 지난 기한"이다
  if (now.getTime() < deadline) deadline -= DAY_MS;
  const requiredSince = deadline - (DUMP_DEADLINE_MINUTES - DUMP_START_MINUTES) * 60_000;

  const successes = records
    .filter((r) => (r.status === "SUCCEEDED" || r.status === "SKIPPED") && r.finishedAt)
    .map((r) => (r.finishedAt as Date).getTime());
  const last = successes.length > 0 ? Math.max(...successes) : null;
  const healthy = successes.some((t) => t >= requiredSince);
  // 오늘 기한 전(아직 어제 기한이 기준)이어도, 어제 기한이 지났는데 성공이 없으면 누락이다
  return {
    state: healthy ? "ok" : "overdue",
    lastSuccessAt: last === null ? null : new Date(last),
    expectedBy: new Date(deadline),
  };
}

// ===== 변경 토큰: 변경이 없으면 자동 덤프를 건너뛴다 =====
export interface TableChangeStats {
  ins: bigint;
  upd: bigint;
  del: bigint;
}

/** 테이블별 삽입·수정·삭제 수의 합. DB 통계(`pg_stat_user_tables`)에서 만든 값이 같으면 그 사이 변경이 없다 */
export function changeToken(stats: TableChangeStats[]): string {
  return stats.reduce((sum, s) => sum + s.ins + s.upd + s.del, 0n).toString();
}

/**
 * 직전 성공 덤프의 토큰과 같을 때만 건너뛴다. 모르거나(null) 달라졌거나 줄어들었으면(통계 초기화) 덤프한다.
 * 어긋났을 때 덤프하는 쪽이 안전하다.
 */
export function shouldSkipDump(previous: string | null, current: string | null): boolean {
  return previous !== null && current !== null && previous === current;
}

// ===== 시스템 관리자 (M7 Q1) =====
/**
 * DB 덤프는 모든 계정의 데이터를 담으므로 환경 변수의 이메일 목록에 있고 **이메일이 인증된** 사용자만 다룬다.
 * 목록은 쉼표로 구분하며 대소문자·앞뒤 공백을 무시한다. 완전히 같은 이메일만 허용한다.
 */
export function isSystemAdmin(
  email: string,
  emailVerified: boolean,
  allowList: string | undefined,
): boolean {
  if (!emailVerified || !allowList) return false;
  const me = email.trim().toLowerCase();
  if (me === "") return false;
  return allowList
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== "")
    .includes(me);
}

// ===== 내보내기 ZIP =====
const FORMULA_START = /^[=+\-@\t\r]/;

/** CSV 한 칸. 엑셀이 수식으로 실행할 시작 글자 앞에 `'`를 붙이고(수식 주입 방어), 쉼표·따옴표·줄바꿈이 있으면 감싼다 */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** 머리글과 행을 CSV로. 엑셀이 한글을 깨뜨리지 않도록 UTF-8 BOM을 붙인다 */
export function toCsv(headers: string[], rows: string[][]): string {
  return `﻿${[headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

const MAX_ENTRY_NAME = 120;

/** ZIP 항목 이름 한 조각을 안전하게 만든다: 경로 구분자·제어 문자는 `_`, 너무 길면 확장자를 살려 자른다 */
export function safeEntryName(name: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자를 일부러 걸러낸다
  let out = name.replace(/[\\/\u0000-\u001f\u007f]/g, "_");
  if (out === "" || out === "." || out === "..") return "_";
  if (out.length > MAX_ENTRY_NAME) {
    const dot = out.lastIndexOf(".");
    const ext = dot > 0 && out.length - dot <= 10 ? out.slice(dot) : "";
    out = out.slice(0, MAX_ENTRY_NAME - ext.length) + ext;
  }
  return out;
}

export interface ExportFileEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface ExportManifestInput {
  account: { id: string; name: string };
  /** ISO 시각 */
  generatedAt: string;
  files: ExportFileEntry[];
  counts: Record<string, number>;
}

export const EXPORT_SCHEMA_VERSION = 1;

/** `manifest.json` 내용. 파일을 경로순으로 정렬해 같은 입력이면 같은 바이트가 나온다 */
export function buildExportManifest(input: ExportManifestInput): string {
  return canonicalJson({
    schemaVersion: EXPORT_SCHEMA_VERSION,
    account: input.account,
    generatedAt: input.generatedAt,
    counts: input.counts,
    files: [...input.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  });
}

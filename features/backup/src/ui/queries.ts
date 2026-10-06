"use client";

import { api } from "@fmerp/shared/lib/api";
import { useQuery } from "@tanstack/react-query";

export interface SystemBackupItem {
  id: string;
  kind: "auto" | "manual";
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "SKIPPED" | "FAILED";
  note: string | null;
  requestedByName: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  size: number | null;
  sha256: string | null;
  pgDumpVersion: string | null;
  error: string | null;
  deleteRequestedAt: string | null;
  downloads: { at: string; userName: string | null }[];
}

export interface SystemBackups {
  health: { state: "ok" | "overdue"; lastSuccessAt: string | null; expectedBy: string };
  items: SystemBackupItem[];
}

export interface AccountExportItem {
  id: string;
  status: "QUEUED" | "RUNNING" | "READY" | "FAILED" | "EXPIRED";
  requestedByName: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  size: number | null;
  sha256: string | null;
  expiresAt: string | null;
  error: string | null;
  downloads: { at: string; userName: string | null }[];
}

export interface AccountExports {
  allowAdminExport: boolean;
  items: AccountExportItem[];
}

/** 파일 크기를 읽기 쉽게 (바이트 → KB·MB·GB) */
export function formatBytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

const ACTIVE = new Set(["QUEUED", "RUNNING"]);

/** DB 덤프 이력. 대기·실행 중인 덤프가 있으면 5초마다 다시 읽는다 */
export const useSystemBackups = (enabled: boolean) =>
  useQuery({
    queryKey: ["system-backups"],
    queryFn: () => api<SystemBackups>("/api/system/backups"),
    enabled,
    refetchInterval: (q) => (q.state.data?.items.some((i) => ACTIVE.has(i.status)) ? 5000 : false),
  });

/** 계정 내보내기 이력. 만드는 중인 것이 있으면 5초마다 다시 읽는다 */
export const useAccountExports = (enabled: boolean) =>
  useQuery({
    queryKey: ["account-exports"],
    queryFn: () => api<AccountExports>("/api/account/exports"),
    enabled,
    refetchInterval: (q) => (q.state.data?.items.some((i) => ACTIVE.has(i.status)) ? 5000 : false),
  });

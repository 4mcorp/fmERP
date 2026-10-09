import { DOC_STATUS_LABEL, STEP_STATUS_LABEL } from "../lib/types";
import { Badge } from "./badge";

export type StatusKind = "document" | "step";
export type StatusTone = "success" | "warning" | "danger" | "info" | "accent" | "neutral" | "muted";

const DOCUMENT_TONE: Record<string, StatusTone> = {
  DRAFT: "neutral",
  IN_PROGRESS: "info",
  ON_HOLD: "warning",
  WITHDRAWN: "muted",
  REJECTED: "danger",
  COMPLETED: "success",
  CANCELED: "muted",
  ARCHIVED: "neutral",
};

const STEP_TONE: Record<string, StatusTone> = {
  PENDING: "muted",
  ACTIVE: "info",
  APPROVED: "success",
  REJECTED: "danger",
  HELD: "warning",
  SKIPPED: "neutral",
  DELEGATED: "accent",
  POST_PENDING: "warning",
  POST_APPROVED: "success",
};

const TONE_VARIANT = {
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
  accent: "accent",
  neutral: "outline",
  muted: "secondary",
} as const;

/** 상태 값 → 색 의미. 알 수 없는 값은 neutral. */
export function statusTone(kind: StatusKind, status: string): StatusTone {
  const table = kind === "document" ? DOCUMENT_TONE : STEP_TONE;
  return Object.hasOwn(table, status) ? (table[status] as StatusTone) : "neutral";
}

/** 결재 문서·단계 상태 배지. 매핑 표는 이 파일이 소유한다 (색만이 아니라 라벨 텍스트도 항상 보인다). */
export function StatusBadge({
  kind,
  status,
  className,
}: {
  kind: StatusKind;
  status: string;
  className?: string;
}) {
  const labels = kind === "document" ? DOC_STATUS_LABEL : STEP_STATUS_LABEL;
  const label = Object.hasOwn(labels, status) ? labels[status] : status;
  return (
    <Badge variant={TONE_VARIANT[statusTone(kind, status)]} className={className}>
      {label}
    </Badge>
  );
}

import type { DocStatus } from "./approval-types";

/** 문서 상태 전이표 (PRD 5.4.1). 모든 상태 변경은 이 표를 거친다. */
const TRANSITIONS: Record<DocStatus, readonly DocStatus[]> = {
  DRAFT: ["IN_PROGRESS"],
  IN_PROGRESS: ["WITHDRAWN", "ON_HOLD", "REJECTED", "COMPLETED"],
  ON_HOLD: ["IN_PROGRESS"],
  WITHDRAWN: ["DRAFT"],
  REJECTED: [],
  COMPLETED: ["CANCELED", "ARCHIVED"],
  CANCELED: [],
  ARCHIVED: [],
};

export const allowedTransitions = (from: DocStatus): readonly DocStatus[] => TRANSITIONS[from];

export const canTransition = (from: DocStatus, to: DocStatus): boolean =>
  TRANSITIONS[from].includes(to);

export function assertTransition(from: DocStatus, to: DocStatus): void {
  if (!canTransition(from, to)) throw new Error(`허용되지 않은 문서 상태 전이: ${from} → ${to}`);
}

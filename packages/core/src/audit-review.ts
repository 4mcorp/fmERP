// 월 1회 접속 기록 점검의 대상 달과 상태 판정 (PRD AUD-026). 달은 KST 기준이다.
const KST_OFFSET_MS = 9 * 3_600_000;

export interface AuditReviewRecord {
  /** 점검 대상 달 (`YYYY-MM`) */
  period: string;
  reviewedAt: Date;
  abnormal: boolean;
}

export type ReviewState = "pending" | "done" | "abnormal";

export interface ReviewStatus<T extends AuditReviewRecord = AuditReviewRecord> {
  period: string;
  state: ReviewState;
  /** 그 달의 가장 마지막 점검 기록 (정정은 새 기록으로 하므로 마지막 건이 현재 상태) */
  last: T | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

function kstYearMonth(date: Date): { year: number; month: number } {
  const d = new Date(date.getTime() + KST_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** 월 오프셋(0=이번 달, -1=직전 달, …)의 `YYYY-MM` */
function shiftPeriod(now: Date, offset: number): string {
  const { year, month } = kstYearMonth(now);
  const index = year * 12 + (month - 1) + offset;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** 지금 점검해야 하는 달: 직전 달 */
export function reviewTargetPeriod(now: Date): string {
  return shiftPeriod(now, -1);
}

/** 직전 달부터 거꾸로 `months`개 달의 점검 상태(최신순). 이번 달은 끝나지 않았으므로 넣지 않는다 */
export function reviewStatuses<T extends AuditReviewRecord>(
  now: Date,
  records: T[],
  months: number,
): ReviewStatus<T>[] {
  const latest = new Map<string, T>();
  for (const r of records) {
    const prev = latest.get(r.period);
    if (!prev || r.reviewedAt.getTime() >= prev.reviewedAt.getTime()) latest.set(r.period, r);
  }
  return Array.from({ length: months }, (_, i) => {
    const period = shiftPeriod(now, -1 - i);
    const last = latest.get(period) ?? null;
    const state: ReviewState = !last ? "pending" : last.abnormal ? "abnormal" : "done";
    return { period, state, last };
  });
}

/**
 * 운영 알림이 읽는 감사·백업 판정 규칙의 계약. 판정 함수는 감사·백업 기능이 제공하고,
 * 알림 기능은 합성 루트(`apps/worker/src/main.ts`)가 주입한 함수만 호출한다.
 * 구현이 이 모양을 지키는지는 합성 루트에서 타입 검사로 확인된다.
 */

interface AuditReviewRecord {
  /** 점검 대상 달 (`YYYY-MM`) */
  period: string;
  reviewedAt: Date;
  abnormal: boolean;
}

interface AuditReviewStatus {
  period: string;
  state: "pending" | "done" | "abnormal";
}

interface BackupRecord {
  status: string;
  kind: string;
  finishedAt: Date | null;
}

interface BackupHealth {
  state: "ok" | "overdue";
  /** 마지막 성공 신호의 끝난 시각. 없으면 null */
  lastSuccessAt: Date | null;
  /** 이 기한 전에 성공 신호가 있었어야 한다 */
  expectedBy: Date;
}

export interface OpsAlertRules {
  /** 직전 달부터 거꾸로 `months`개 달의 점검 상태(최신순) */
  reviewStatuses(now: Date, records: AuditReviewRecord[], months: number): AuditReviewStatus[];
  backupHealth(now: Date, records: BackupRecord[]): BackupHealth;
  isSystemAdmin(email: string, emailVerified: boolean, allowList: string | undefined): boolean;
}

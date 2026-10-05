// 덤프·내보내기 이력 (PRD BAK-005·006·007·009, M7 plan). 시스템 덤프와 계정 내보내기는 소유 범위가 달라 테이블을 나눈다.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, primaryId } from "./columns";
import { account, membership } from "./tenant";

export const SYSTEM_BACKUP_KINDS = ["auto", "manual"] as const;
export const SYSTEM_BACKUP_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "SKIPPED",
  "FAILED",
] as const;

/**
 * DB 덤프 이력. **모든 계정의 데이터가 들어 있는 덤프**라 계정 소속이 없고 RLS 대상도 아니다.
 * 앱 역할은 시스템 관리자 경로에서만 읽고(SELECT)·요청하며(INSERT)·삭제 표시(delete_requested_at)만 바꾼다.
 * 덤프를 실행하는 worker의 백업 역할(fmerp_backup)이 나머지 열을 갱신한다. 삭제 권한은 누구에게도 없다.
 */
export const systemBackup = pgTable(
  "system_backup",
  {
    id: primaryId(),
    kind: text({ enum: SYSTEM_BACKUP_KINDS }).notNull(),
    status: text({ enum: SYSTEM_BACKUP_STATUSES }).notNull(),
    /** 수동 덤프를 요청한 사용자. 자동 덤프는 null */
    requestedByUserId: uuid(),
    note: text(),
    requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    /** 암호화된 덤프 파일의 크기·SHA-256 (SUCCEEDED일 때) */
    size: bigint({ mode: "number" }),
    sha256: text(),
    storageKey: text(),
    /** 이 덤프를 뜰 때의 변경 토큰. 다음 자동 덤프가 같으면 건너뛴다 (BAK-005) */
    changeToken: text(),
    pgDumpVersion: text(),
    error: text(),
    /** 삭제 요청 시각. 앱은 객체를 지울 수 없어 태그로 표시하고 수명 주기 규칙이 지운다 (M7 plan Q3) */
    deleteRequestedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.requestedAt),
    check(
      "system_backup_done",
      sql`(${t.status} <> 'SUCCEEDED') or (${t.size} is not null and ${t.sha256} is not null and ${t.storageKey} is not null)`,
    ),
    // 덤프는 한 번에 하나만 (요청 대기·실행 중인 행이 둘이 될 수 없다)
    uniqueIndex("system_backup_single_active")
      .on(sql`(1)`)
      .where(sql`${t.status} in ('QUEUED', 'RUNNING')`),
  ],
);

export const BACKUP_JOB_TYPES = ["account_export"] as const;
export const BACKUP_JOB_STATUSES = ["QUEUED", "RUNNING", "READY", "FAILED", "EXPIRED"] as const;

/** 계정 전체 내보내기 작업 (PRD BAK-009). 모든 행은 account_id + RLS */
export const backupJob = pgTable(
  "backup_job",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    type: text({ enum: BACKUP_JOB_TYPES }).notNull().default("account_export"),
    status: text({ enum: BACKUP_JOB_STATUSES }).notNull().default("QUEUED"),
    requestedByMembershipId: uuid().notNull(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    size: bigint({ mode: "number" }),
    sha256: text(),
    storageKey: text(),
    /** 이 시각이 지나면 EXPIRED. 파일은 버킷 수명 주기 규칙이 지운다 (보관 7일) */
    expiresAt: timestamp({ withTimezone: true }),
    error: text(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.requestedByMembershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }),
    check(
      "backup_job_ready",
      sql`(${t.status} <> 'READY') or (${t.size} is not null and ${t.sha256} is not null and ${t.storageKey} is not null and ${t.expiresAt} is not null)`,
    ),
    // 한 계정에서 동시에 하나만 (요청 대기·실행 중)
    uniqueIndex("backup_job_single_active")
      .on(t.accountId)
      .where(sql`${t.status} in ('QUEUED', 'RUNNING')`),
    index().on(t.accountId, t.createdAt),
    index().on(t.status, t.createdAt),
  ],
);

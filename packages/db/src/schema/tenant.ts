// PRD의 "계정"(테넌트)과 구성원·초대 (ADR 0005). account·membership은 Better Auth organization 모델과 필드를 맞춘다.

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, primaryId } from "./columns";
import { user } from "./user";

/** 계정별 보안 정책. 비어 있으면 기본값을 쓴다 (PRD AUTH-008) */
export interface SecurityPolicy {
  idleTimeoutMinutes?: number;
  absoluteTimeoutHours?: number;
  /** 재인증(결재 PIN) 사용 여부. 기본 true (AUTH-009, ADM-001) */
  pinRequired?: boolean;
  /** 첨부 정책 (ADM-001, 실제 적용은 M4) */
  attachmentMaxMb?: number;
  attachmentExtensions?: string[];
  /**
   * 계정 관리자의 계정 전체 내보내기를 허용할지. 기본 꺼짐 (PRD 3.3 각주 2).
   * 내보내기 ZIP에는 모든 완료 문서 본문이 들어 있어, 문서를 볼 수 없는 관리자에게는 소유자가 명시적으로 허용했을 때만 연다
   */
  allowAdminExport?: boolean;
}

/** @owner shared */
export const account = pgTable(
  "account",
  {
    id: primaryId(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    logo: text(),
    metadata: text(),
    securityPolicy: jsonb().$type<SecurityPolicy>().notNull().default({}),
    /** 부서 최대 뎁스 1~5 (ORG-010). 낮추기는 core 검사와 DB 트리거가 막는다 */
    maxDeptDepth: integer().notNull().default(1),
    /** 결재란 최대 칸 수(기안 포함). 2~30, 기본 15 (설계 2.4 R3). 한 줄 최대는 ceil(값/2) */
    approvalLineMaxCells: integer().notNull().default(15),
    allowedDomains: text().array().notNull().default(sql`'{}'::text[]`),
    timezone: text().notNull().default("Asia/Seoul"),
    locale: text().notNull().default("ko"),
    createdAt: createdAt(),
  },
  (t) => [
    check("account_max_dept_depth_range", sql`${t.maxDeptDepth} between 1 and 5`),
    check("account_approval_line_max_cells_range", sql`${t.approvalLineMaxCells} between 2 and 30`),
  ],
);

export const MEMBERSHIP_ROLES = ["owner", "admin", "member"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const MEMBERSHIP_STATUSES = ["active", "leave", "left"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** @owner shared */
export const membership = pgTable(
  "membership",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text().notNull(),
    /** active: 재직, leave: 휴직, left: 퇴사·비활성 (PRD ORG-034, AUTH-015) */
    status: text({ enum: MEMBERSHIP_STATUSES }).notNull().default("active"),
    employeeNo: text(),
    joinedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex().on(t.accountId, t.userId),
    unique("membership_id_account_unique").on(t.id, t.accountId),
    unique().on(t.accountId, t.employeeNo),
    index().on(t.userId),
  ],
);

/**
 * 초대 (PRD AUTH-006). 링크로 수락하므로 이메일 일치를 요구하지 않는다. 토큰은 해시만 저장한다.
 *
 * @owner account
 */
export const invitation = pgTable(
  "invitation",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    tokenHash: text().notNull().unique(),
    role: text({ enum: MEMBERSHIP_ROLES }).notNull().default("member"),
    /** 안내용 (선택). 수락 조건이 아니다 */
    email: text(),
    /** 수락 시 적용할 사업자·부서·직위 (M2에서 사용) */
    preset: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    usedBy: uuid().references(() => user.id),
    revokedAt: timestamp({ withTimezone: true }),
    createdBy: uuid()
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.accountId)],
);

/**
 * passkey 등록 토큰 (1회용). 관리자가 사전 등록한 사용자가 처음 passkey를 등록할 때 쓴다.
 * 토큰 원문은 저장하지 않고 해시만 둔다. 재발급하면 이전 토큰은 revokedAt으로 폐기한다.
 *
 * @owner account
 */
export const enrollmentToken = pgTable(
  "enrollment_token",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    createdBy: uuid()
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.accountId), index().on(t.userId)],
);

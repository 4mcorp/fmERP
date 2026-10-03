// PRD의 "계정"(테넌트)과 구성원·초대 (ADR 0005). account·membership은 Better Auth organization 모델과 필드를 맞춘다.
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { createdAt, primaryId } from "./columns";

/** 계정별 보안 정책. 비어 있으면 기본값을 쓴다 (PRD AUTH-008) */
export interface SecurityPolicy {
  idleTimeoutMinutes?: number;
  absoluteTimeoutHours?: number;
}

export const account = pgTable("account", {
  id: primaryId(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  logo: text(),
  metadata: text(),
  securityPolicy: jsonb().$type<SecurityPolicy>().notNull().default({}),
  createdAt: createdAt(),
});

export const MEMBERSHIP_ROLES = ["owner", "admin", "member"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const MEMBERSHIP_STATUSES = ["active", "leave", "left"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

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
  (t) => [uniqueIndex().on(t.accountId, t.userId), index().on(t.userId)],
);

/** 초대 (PRD AUTH-006). 링크로 수락하므로 이메일 일치를 요구하지 않는다. 토큰은 해시만 저장한다. */
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

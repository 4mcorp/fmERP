// Better Auth가 사용하는 테이블 (ADR 0005). 필드 이름은 Better Auth 모델과 맞춘다.
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, primaryId, updatedAt } from "./columns";
import { account } from "./tenant";

/** @owner shared */
export const user = pgTable("user", {
  id: primaryId(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  /** 서명·도장 이미지의 S3 키 (PRD AUTH-016) */
  signatureKey: text(),
  stampKey: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** @owner shared */
export const session = pgTable(
  "session",
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    /** Better Auth organization의 activeOrganizationId (AUTH-007) */
    activeAccountId: uuid().references(() => account.id, { onDelete: "set null" }),
    /** 유휴 만료 판단용 (AUTH-008) */
    lastActiveAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** 결재 PIN 재인증 시각 (AUTH-009) */
    pinVerifiedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.userId)],
);

/**
 * 로그인 수단 (Better Auth의 account 모델). 테넌트 account와 구분하기 위해 이름을 바꿨다.
 *
 * @owner shared
 */
export const userIdentity = pgTable(
  "user_identity",
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** 공급자가 준 사용자 고유 ID (Google sub, Naver id). 이메일로 식별하지 않는다 (AUTH-002) */
    providerAccountId: text().notNull(),
    providerId: text().notNull(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.providerId, t.providerAccountId), index().on(t.userId)],
);

/** @owner shared */
export const verification = pgTable(
  "verification",
  {
    id: primaryId(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.identifier)],
);

/**
 * 결재 PIN (PRD AUTH-009). Argon2id 해시만 저장한다.
 *
 * @owner shared
 */
export const approvalPin = pgTable("approval_pin", {
  userId: uuid()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  pinHash: text().notNull(),
  failedCount: integer().notNull().default(0),
  lockedUntil: timestamp({ withTimezone: true }),
  updatedAt: updatedAt(),
});

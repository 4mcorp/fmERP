// 감사 로그 (PRD AUD-020~027). 앱에서는 INSERT·SELECT만 가능하다 (AUD-022, 마이그레이션의 GRANT 참고).
// 다른 테이블이 지워지거나 바뀌어도 기록이 남도록 외래 키를 두지 않는다.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, primaryId } from "./columns";
import { account, membership } from "./tenant";

export const AUDIT_RESULTS = ["success", "failure"] as const;

/** @owner shared */
export const auditLog = pgTable(
  "audit_log",
  {
    id: primaryId(),
    /** 계정(테넌트). 로그인처럼 계정 밖에서 일어난 행위는 null */
    accountId: uuid(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** 행위자. 시스템 작업이면 null */
    actorUserId: uuid(),
    /** 대리 처리(대결 등)일 때 원 권한자 */
    onBehalfOfUserId: uuid(),
    /** 수행 업무 (예: auth.login, member.deactivate) */
    action: text().notNull(),
    targetType: text(),
    targetId: text(),
    targetLabel: text(),
    /** 처리한 정보주체 (개인정보 조회·수정 대상) */
    subjectUserId: uuid(),
    /** 변경 전·후 차이. 민감 값은 마스킹 (AUD-027) */
    diff: jsonb(),
    ip: text(),
    userAgent: text(),
    requestId: text(),
    result: text({ enum: AUDIT_RESULTS }).notNull(),
    reason: text(),
  },
  (t) => [index().on(t.accountId, t.occurredAt), index().on(t.actorUserId, t.occurredAt)],
);

/**
 * 월 1회 접속 기록 점검 기록 (PRD AUD-026). 추가만 한다(INSERT·SELECT 권한만).
 * 같은 달에 여러 건이 있을 수 있고 가장 마지막 건이 그 달의 현재 상태다 (정정은 새 건으로).
 *
 * @owner audit
 */
export const auditReview = pgTable(
  "audit_review",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    /** 점검 대상 달 (`YYYY-MM`) */
    period: text().notNull(),
    reviewerMembershipId: uuid().notNull(),
    reviewedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    memo: text(),
    abnormal: boolean().notNull().default(false),
    abnormalNote: text(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.reviewerMembershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }),
    check("audit_review_period", sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      "audit_review_abnormal_note",
      sql`not ${t.abnormal} or length(btrim(coalesce(${t.abnormalNote}, ''))) > 0`,
    ),
    index().on(t.accountId, t.period, t.reviewedAt),
  ],
);

// 감사 로그 (PRD AUD-020~027). 앱에서는 INSERT·SELECT만 가능하다 (AUD-022, 마이그레이션의 GRANT 참고).
// 다른 테이블이 지워지거나 바뀌어도 기록이 남도록 외래 키를 두지 않는다.
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { primaryId } from "./columns";

export const AUDIT_RESULTS = ["success", "failure"] as const;

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

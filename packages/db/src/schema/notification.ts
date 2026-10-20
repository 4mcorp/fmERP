// 알림 (PRD NTF-001·002, M8 plan). notification·event_notified는 account_id + RLS.
// telegram_*는 사용자 단위(여러 계정에 걸침)라 RLS 대상이 아니고 fmerp_auth만 다룬다. 권한·RLS는 마이그레이션 0019.
import {
  bigint,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, primaryId, updatedAt } from "./columns";
import { account, membership } from "./tenant";
import { user } from "./user";

const accountRef = () =>
  uuid()
    .notNull()
    .references(() => account.id, { onDelete: "cascade" });

export const NOTIFICATION_KINDS = [
  "approval_requested",
  "approval_rejected",
  "approval_completed",
  "approval_withdrawn",
  "approval_held",
  "post_approval_requested",
  "delegate_unavailable",
  "line_changed",
  "document_received",
  "audit_review_due",
  "backup_problem",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** NONE: 텔레그램 대상 아님/미연결, PENDING: 발송 대기, SENT, FAILED: 재시도 소진, SKIPPED: 연결 해제·차단 */
export const TELEGRAM_STATUSES = ["NONE", "PENDING", "SENT", "FAILED", "SKIPPED"] as const;

/**
 * 인앱 알림. 외부 채널로 나가는 문구에는 문서 제목·내용을 넣지 않는다 (M8 plan)
 *
 * @owner notification
 */
export const notification = pgTable(
  "notification",
  {
    id: primaryId(),
    accountId: accountRef(),
    recipientMembershipId: uuid().notNull(),
    kind: text({ enum: NOTIFICATION_KINDS }).notNull(),
    documentId: uuid(),
    title: text().notNull(),
    body: text().notNull().default(""),
    /** 외부 채널(텔레그램)로 나가는 문구. 문서 제목·내용이 없다 */
    externalText: text().notNull().default(""),
    /** 같은 사건에 대한 중복 생성을 막는다 (`<event_id>:<kind>`, `audit-review:2026-09` 등) */
    dedupeKey: text().notNull(),
    readAt: timestamp({ withTimezone: true }),
    telegramStatus: text({ enum: TELEGRAM_STATUSES }).notNull().default("NONE"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.recipientMembershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }).onDelete("cascade"),
    uniqueIndex().on(t.recipientMembershipId, t.dedupeKey),
    index().on(t.recipientMembershipId, t.readAt, t.createdAt),
  ],
);

/**
 * 웹 푸시 구독 (구성원의 기기 하나 = 브라우저 또는 홈 화면 앱 하나). 구독 정보는 계정 소속이라 RLS를 받는다.
 * 발송이 404·410으로 거절된 구독은 지운다 (만료 정리)
 *
 * @owner notification
 */
export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: primaryId(),
    accountId: accountRef(),
    membershipId: uuid().notNull(),
    endpoint: text().notNull(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.membershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }).onDelete("cascade"),
    uniqueIndex().on(t.endpoint),
    index().on(t.membershipId),
  ],
);

/**
 * 알림 소비를 마친 결재 이벤트. 커서(id 순서)는 늦게 커밋된 이벤트를 놓칠 수 있어,
 * "아직 처리 표시가 없는 최근 이벤트"를 찾는 방식으로 누락을 막는다 (DB 함수 notification_pending_events).
 *
 * @owner notification
 */
export const eventNotified = pgTable("event_notified", {
  eventId: uuid().primaryKey(),
  accountId: accountRef(),
  createdAt: createdAt(),
});

/**
 * 사용자와 텔레그램 대화의 연결. 사용자당 1개, chat_id도 한 사용자에게만 묶인다
 *
 * @owner notification
 */
export const telegramLink = pgTable(
  "telegram_link",
  {
    userId: uuid()
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    chatId: bigint({ mode: "number" }).notNull(),
    linkedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.chatId)],
);

/**
 * 텔레그램 연결용 일회용 토큰. 원문은 링크에만 있고 해시만 저장한다 (10분 만료·1회용)
 *
 * @owner notification
 */
export const telegramLinkToken = pgTable(
  "telegram_link_token",
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.tokenHash), index().on(t.userId)],
);

export const SYSTEM_SETTING_KEYS = [
  "telegram_mode",
  "telegram_update_offset",
  "telegram_receiver_status",
] as const;

/**
 * 시스템(서버) 설정. 계정 소속이 없고 RLS 대상이 아니다. 변경은 시스템 관리자 경로에서만 한다
 *
 * @owner notification
 */
export const systemSetting = pgTable("system_setting", {
  key: text({ enum: SYSTEM_SETTING_KEYS }).primaryKey(),
  value: jsonb().$type<unknown>().notNull(),
  updatedByUserId: uuid(),
  updatedAt: updatedAt(),
});

// 완료 처리·문서함 저장소 (PRD 5.4·5.6, ADR 0009). 모든 테이블은 account_id + RLS.
// 권한·RLS·불변성 트리거는 마이그레이션 0011이 보장한다.
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { document } from "./approval";
import { createdAt, primaryId, updatedAt } from "./columns";
import { department } from "./org";
import { account, membership } from "./tenant";

const accountRef = () =>
  uuid()
    .notNull()
    .references(() => account.id, { onDelete: "cascade" });

export const PACKAGE_STATUSES = ["PENDING", "READY", "FAILED"] as const;

/**
 * 완료 패키지(S3 `final/`) 생성 상태. READY가 되면 manifest 해시는 바꿀 수 없다 (ADR 0009)
 *
 * @owner completion
 */
export const documentPackage = pgTable(
  "document_package",
  {
    documentId: uuid().primaryKey(),
    accountId: accountRef(),
    status: text({ enum: PACKAGE_STATUSES }).notNull().default("PENDING"),
    attempts: integer().notNull().default(0),
    lastError: text(),
    /** `manifest.json`의 SHA-256 (READY일 때만) */
    manifestHash: text(),
    readyAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.documentId, t.accountId],
      foreignColumns: [document.id, document.accountId],
    }).onDelete("cascade"),
    index().on(t.status, t.updatedAt),
    check(
      "document_package_ready",
      sql`(${t.status} = 'READY') = (${t.manifestHash} is not null and ${t.readyAt} is not null)`,
    ),
  ],
);

export const RECIPIENT_KINDS = ["cc", "receive", "circulate"] as const;

/**
 * 참조·수신·공람 대상 (APV-070·072·073). 결재선 단계가 아니다
 *
 * @owner approval
 */
export const documentRecipient = pgTable(
  "document_recipient",
  {
    id: primaryId(),
    accountId: accountRef(),
    documentId: uuid().notNull(),
    kind: text({ enum: RECIPIENT_KINDS }).notNull(),
    targetMembershipId: uuid(),
    targetDepartmentId: uuid(),
    /** 수신: 지정 담당자. 없으면 수신 부서장이 접수한다 */
    assigneeMembershipId: uuid(),
    receivedByMembershipId: uuid(),
    receivedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("document_recipient_id_account_unique").on(t.id, t.accountId),
    foreignKey({
      columns: [t.documentId, t.accountId],
      foreignColumns: [document.id, document.accountId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.targetMembershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }),
    foreignKey({
      columns: [t.targetDepartmentId, t.accountId],
      foreignColumns: [department.id, department.accountId],
    }),
    foreignKey({
      columns: [t.assigneeMembershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }),
    foreignKey({
      columns: [t.receivedByMembershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }),
    // 대상은 구성원 또는 부서 중 하나. 수신은 부서만
    check(
      "document_recipient_target",
      sql`(${t.targetMembershipId} is null) <> (${t.targetDepartmentId} is null)`,
    ),
    check(
      "document_recipient_receive_department",
      sql`${t.kind} <> 'receive' or ${t.targetDepartmentId} is not null`,
    ),
    check(
      "document_recipient_received",
      sql`(${t.receivedByMembershipId} is null) = (${t.receivedAt} is null)`,
    ),
    index().on(t.documentId),
    index().on(t.targetMembershipId, t.kind),
    index().on(t.targetDepartmentId, t.kind),
  ],
);

/**
 * 참조·공람의 사람별 열람 일시 (APV-072·073). 부서 대상이면 구성원마다 한 행
 *
 * @owner approval
 */
export const documentRecipientRead = pgTable(
  "document_recipient_read",
  {
    id: primaryId(),
    accountId: accountRef(),
    recipientId: uuid().notNull(),
    membershipId: uuid().notNull(),
    readAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.recipientId, t.membershipId),
    foreignKey({
      columns: [t.recipientId, t.accountId],
      foreignColumns: [documentRecipient.id, documentRecipient.accountId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.membershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }),
  ],
);

/**
 * 수신 접수자가 부서 안 담당자에게 배부한 기록 (APV-070)
 *
 * @owner approval
 */
export const documentDistribution = pgTable(
  "document_distribution",
  {
    id: primaryId(),
    accountId: accountRef(),
    recipientId: uuid().notNull(),
    membershipId: uuid().notNull(),
    distributedByMembershipId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.recipientId, t.membershipId),
    foreignKey({
      columns: [t.recipientId, t.accountId],
      foreignColumns: [documentRecipient.id, documentRecipient.accountId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.membershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }),
    foreignKey({
      columns: [t.distributedByMembershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }),
    index().on(t.membershipId),
  ],
);

/**
 * 본문 전문 검색용 텍스트 (APV-082). 본문은 S3에만 있어 상신할 때 추출해 둔다 (ADR 0009)
 *
 * @owner approval
 */
export const documentSearch = pgTable(
  "document_search",
  {
    documentId: uuid().primaryKey(),
    accountId: accountRef(),
    body: text().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.documentId, t.accountId],
      foreignColumns: [document.id, document.accountId],
    }).onDelete("cascade"),
  ],
);

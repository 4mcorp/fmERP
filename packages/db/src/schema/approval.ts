// 결재 엔진 저장소 (PRD 5.4, ADR 0007). 모든 테이블은 account_id + RLS.
// 무결성(완료 후 불변, 추가 전용)은 마이그레이션 0006의 트리거·권한이 보장한다.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { createdAt, primaryId, updatedAt } from "./columns";
import { business } from "./org";
import { account, membership } from "./tenant";

const accountRef = () =>
  uuid()
    .notNull()
    .references(() => account.id, { onDelete: "cascade" });

export const DOCUMENT_STATUSES = [
  "DRAFT",
  "IN_PROGRESS",
  "ON_HOLD",
  "WITHDRAWN",
  "REJECTED",
  "COMPLETED",
  "CANCELED",
  "ARCHIVED",
] as const;

export interface DocumentPolicy {
  disagree: "reject" | "comment";
  rejectTo: "drafter" | "previous";
  auditCanReject: boolean;
}

/** 문서번호 설정 (APV-060·061). 양식(M4)이 정해 문서를 만들 때 복사한다 */
export interface DocumentNumbering {
  rule: string;
  cycle: "year" | "month" | "none";
  /** 채번 시점: 상신 시 / 완료 시 */
  at: "submit" | "complete";
  departmentCode: string;
  formCode: string;
}

/**
 * 결재 문서. 본문은 S3 리비전에 있고 DB에는 색인만 둔다 (document_revision, ADR 0008)
 *
 * @owner approval
 */
export const document = pgTable(
  "document",
  {
    id: primaryId(),
    accountId: accountRef(),
    businessId: uuid().notNull(),
    drafterMembershipId: uuid().notNull(),
    /** 기안 시점의 부서명·직위·직책 스냅샷 (ORG-017) */
    drafterSnapshot: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    title: text().notNull(),
    status: text({ enum: DOCUMENT_STATUSES }).notNull().default("DRAFT"),
    policy: jsonb().$type<DocumentPolicy>().notNull(),
    numbering: jsonb().$type<DocumentNumbering>(),
    docNo: text(),
    /** 위임 범위 판단용 양식 분류 (APV-050) */
    formCategory: text(),
    /** ERP 모듈 연동 (APV-090) */
    sourceType: text(),
    sourceId: text(),
    /** 재기안 시 원문 (APV-019) */
    supersedes: uuid(),
    contentHash: text(),
    /** 작성 당시 양식 버전 (APV-005). 모듈 연동 등 양식 없는 문서는 null */
    formVersionId: uuid(),
    securityLevel: text({ enum: ["normal", "confidential", "secret"] })
      .notNull()
      .default("normal"),
    urgent: boolean().notNull().default(false),
    desiredDueDate: date(),
    /** 금액 검색용 (원 단위). 양식의 금액 필드 값을 상신할 때 복사한다 (APV-082, ADR 0009) */
    amount: bigint({ mode: "number" }),
    /** 가장 최근 본문 리비전 번호 (0이면 아직 저장된 본문이 없다) */
    latestRevision: integer().notNull().default(0),
    submittedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("document_id_account_unique").on(t.id, t.accountId),
    foreignKey({
      columns: [t.businessId, t.accountId],
      foreignColumns: [business.id, business.accountId],
    }),
    foreignKey({
      columns: [t.drafterMembershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }),
    foreignKey({ columns: [t.supersedes], foreignColumns: [t.id] }),
    index().on(t.status),
    index().on(t.drafterMembershipId),
    index().on(t.sourceType, t.sourceId),
  ],
);

/**
 * 결재선 단계. version은 낙관적 잠금이다 (APV-045)
 *
 * @owner approval
 */
export const approvalStep = pgTable(
  "approval_step",
  {
    id: primaryId(),
    accountId: accountRef(),
    documentId: uuid().notNull(),
    seq: integer().notNull(),
    type: text({ enum: ["approve", "agree", "cooperate", "audit", "post"] }).notNull(),
    assigneeIds: uuid().array().notNull(),
    /** 결재 시점의 처리자 이름·직위 등 (ORG-017) */
    assigneeSnapshot: jsonb().$type<Record<string, unknown>[]>().notNull().default([]),
    /** 활성화 때 정해진 대결자: 처리자 id → 대결자 id */
    delegates: jsonb().$type<Record<string, string>>().notNull().default({}),
    canFinalize: boolean().notNull().default(false),
    /** null이면 전원 */
    quorum: integer(),
    status: text({
      enum: [
        "PENDING",
        "ACTIVE",
        "APPROVED",
        "REJECTED",
        "HELD",
        "SKIPPED",
        "DELEGATED",
        "POST_PENDING",
        "POST_APPROVED",
      ],
    })
      .notNull()
      .default("PENDING"),
    version: integer().notNull().default(0),
    heldBy: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("approval_step_id_account_unique").on(t.id, t.accountId),
    foreignKey({
      columns: [t.documentId, t.accountId],
      foreignColumns: [document.id, document.accountId],
    }).onDelete("cascade"),
    index().on(t.documentId, t.seq),
    check("approval_step_assignees", sql`cardinality(${t.assigneeIds}) >= 1`),
    check("approval_step_quorum", sql`${t.quorum} is null or ${t.quorum} >= 1`),
  ],
);

/**
 * 결재 처리 기록. 추가만 가능하다 (APV-046, INSERT·SELECT 권한만)
 *
 * @owner approval
 */
export const approvalAction = pgTable(
  "approval_action",
  {
    id: primaryId(),
    accountId: accountRef(),
    documentId: uuid().notNull(),
    stepId: uuid().notNull(),
    actorMembershipId: uuid().notNull(),
    onBehalfOfMembershipId: uuid(),
    action: text().notNull(),
    comment: text(),
    /** 같은 키로 다시 요청하면 같은 결과를 돌려준다 (APV-045) */
    idempotencyKey: text().notNull(),
    /** 처리 시점의 문서 해시 (APV-016, M4가 채움) */
    docHash: text(),
    ip: text(),
    userAgent: text(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.stepId, t.idempotencyKey),
    foreignKey({
      columns: [t.stepId, t.accountId],
      foreignColumns: [approvalStep.id, approvalStep.accountId],
    }),
    foreignKey({
      columns: [t.actorMembershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }),
    index().on(t.documentId),
  ],
);

/**
 * 도메인 이벤트 outbox. 소비자(PDF·알림·웹훅)는 M5·M8에서 추가한다 (ADR 0007)
 *
 * @owner approval
 */
export const approvalEvent = pgTable(
  "approval_event",
  {
    id: primaryId(),
    accountId: accountRef(),
    documentId: uuid().notNull(),
    type: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.documentId), index().on(t.createdAt)],
);

/**
 * 문서번호 시리즈 (APV-061). last_seq를 한 문장으로 올려 누락·중복 없이 채번한다
 *
 * @owner approval
 */
export const docNumberSeries = pgTable(
  "doc_number_series",
  {
    id: primaryId(),
    accountId: accountRef(),
    businessId: uuid().notNull(),
    key: text().notNull(),
    lastSeq: integer().notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.businessId, t.key),
    foreignKey({
      columns: [t.businessId, t.accountId],
      foreignColumns: [business.id, business.accountId],
    }),
  ],
);

export interface DelegationScope {
  kind: "all" | "category";
  categories?: string[];
}

/**
 * 부재·대결 설정 (APV-050·052·053)
 *
 * @owner approval
 */
export const delegation = pgTable(
  "delegation",
  {
    id: primaryId(),
    accountId: accountRef(),
    membershipId: uuid().notNull(),
    delegateMembershipId: uuid().notNull(),
    validFrom: timestamp({ withTimezone: true }).notNull(),
    validTo: timestamp({ withTimezone: true }).notNull(),
    scope: jsonb().$type<DelegationScope>().notNull().default({ kind: "all" }),
    reason: text(),
    createdBy: uuid().references(() => user.id),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.membershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }),
    foreignKey({
      columns: [t.delegateMembershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }),
    check("delegation_period", sql`${t.validFrom} < ${t.validTo}`),
    check("delegation_not_self", sql`${t.membershipId} <> ${t.delegateMembershipId}`),
    index().on(t.membershipId),
  ],
);

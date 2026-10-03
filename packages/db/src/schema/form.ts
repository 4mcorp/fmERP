// 양식·결재선 템플릿·문서 리비전·첨부·의견 (PRD 5.4.2~5.4.3, ADR 0008). 모든 테이블은 account_id + RLS.
import {
  bigint,
  boolean,
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
import { document } from "./approval";
import { createdAt, primaryId, updatedAt } from "./columns";
import { account, membership } from "./tenant";

const accountRef = () =>
  uuid()
    .notNull()
    .references(() => account.id, { onDelete: "cascade" });

export interface FormScope {
  /** 비어 있으면 전체 */
  businessIds?: string[];
  departmentIds?: string[];
}

/** 양식 (APV-004). 내용은 form_version에 불변으로 저장하고, 현재 버전은 가장 큰 version이다 */
export const form = pgTable(
  "form",
  {
    id: primaryId(),
    accountId: accountRef(),
    code: text().notNull(),
    name: text().notNull(),
    category: text().notNull().default("일반"),
    active: boolean().notNull().default(true),
    scope: jsonb().$type<FormScope>().notNull().default({}),
    createdBy: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique().on(t.accountId, t.code), unique("form_id_account_unique").on(t.id, t.accountId)],
);

/** 양식 버전 (APV-005). 추가만 가능하다(UPDATE·DELETE 권한 없음) */
export const formVersion = pgTable(
  "form_version",
  {
    id: primaryId(),
    accountId: accountRef(),
    formId: uuid().notNull(),
    version: integer().notNull(),
    schema: jsonb().$type<Record<string, unknown>>().notNull(),
    layout: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** 기본 결재선 항목 (M3 DraftLineItem[]) */
    defaultLine: jsonb().$type<Record<string, unknown>[]>().notNull().default([]),
    numbering: jsonb().$type<Record<string, unknown>>(),
    /** 1·3·5·10년, 0은 영구 */
    retentionYears: integer().notNull().default(3),
    securityDefault: text({ enum: ["normal", "confidential", "secret"] })
      .notNull()
      .default("normal"),
    /** 참조·수신 기본값 */
    recipients: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    allowLineEdit: boolean().notNull().default(true),
    policy: jsonb().$type<Record<string, unknown>>().notNull(),
    createdBy: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.formId, t.version),
    unique("form_version_id_account_unique").on(t.id, t.accountId),
    foreignKey({ columns: [t.formId, t.accountId], foreignColumns: [form.id, form.accountId] }),
  ],
);

/** 결재선 템플릿: 공용(양식별 기본) 또는 개인 즐겨찾기(owner 지정) (APV-033) */
export const approvalLineTemplate = pgTable(
  "approval_line_template",
  {
    id: primaryId(),
    accountId: accountRef(),
    formId: uuid(),
    ownerMembershipId: uuid(),
    name: text().notNull(),
    items: jsonb().$type<Record<string, unknown>[]>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ columns: [t.formId, t.accountId], foreignColumns: [form.id, form.accountId] }),
    foreignKey({
      columns: [t.ownerMembershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }).onDelete("cascade"),
    index().on(t.formId),
    index().on(t.ownerMembershipId),
  ],
);

/** 사용자별 양식 즐겨찾기·최근 사용 (APV-010) */
export const userFormPref = pgTable(
  "user_form_pref",
  {
    id: primaryId(),
    accountId: accountRef(),
    membershipId: uuid().notNull(),
    formId: uuid().notNull(),
    favorite: boolean().notNull().default(false),
    lastUsedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique().on(t.membershipId, t.formId),
    foreignKey({
      columns: [t.membershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.formId, t.accountId],
      foreignColumns: [form.id, form.accountId],
    }).onDelete("cascade"),
  ],
);

/** 본문 저장본 색인. 본문 자체는 S3 revisions/{n}.json (BAK-002). 추가만 가능 */
export const documentRevision = pgTable(
  "document_revision",
  {
    id: primaryId(),
    accountId: accountRef(),
    documentId: uuid().notNull(),
    n: integer().notNull(),
    storageKey: text().notNull(),
    sha256: text().notNull(),
    size: integer().notNull(),
    savedByMembershipId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.documentId, t.n),
    foreignKey({
      columns: [t.documentId, t.accountId],
      foreignColumns: [document.id, document.accountId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.savedByMembershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }),
  ],
);

/** 첨부 (APV-013, FILE-002). 파일 자체는 S3 */
export const attachment = pgTable(
  "attachment",
  {
    id: primaryId(),
    accountId: accountRef(),
    documentId: uuid().notNull(),
    storageKey: text().notNull(),
    filename: text().notNull(),
    size: bigint({ mode: "number" }).notNull(),
    mime: text().notNull(),
    sha256: text().notNull(),
    uploadedByMembershipId: uuid().notNull(),
    /** none: 검사 안 함 (악성코드 검사는 P1) */
    scanStatus: text().notNull().default("none"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.documentId, t.accountId],
      foreignColumns: [document.id, document.accountId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.uploadedByMembershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }),
    index().on(t.documentId),
  ],
);

/** 단계별 의견 (APV-042). 추가만 가능 */
export const approvalComment = pgTable(
  "approval_comment",
  {
    id: primaryId(),
    accountId: accountRef(),
    documentId: uuid().notNull(),
    stepId: uuid(),
    authorMembershipId: uuid().notNull(),
    body: text().notNull(),
    /** all: 결재선 전체, drafter: 기안자만 */
    visibility: text({ enum: ["all", "drafter"] })
      .notNull()
      .default("all"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.documentId, t.accountId],
      foreignColumns: [document.id, document.accountId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.authorMembershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }),
    index().on(t.documentId),
  ],
);

/** 관련 문서 링크 (APV-014) */
export const documentLink = pgTable(
  "document_link",
  {
    id: primaryId(),
    accountId: accountRef(),
    documentId: uuid().notNull(),
    linkedDocumentId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.documentId, t.linkedDocumentId),
    foreignKey({
      columns: [t.documentId, t.accountId],
      foreignColumns: [document.id, document.accountId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.linkedDocumentId, t.accountId],
      foreignColumns: [document.id, document.accountId],
    }),
  ],
);

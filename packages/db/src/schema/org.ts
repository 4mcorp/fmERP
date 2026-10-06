// 조직·권한 (PRD 5.2·5.3, ADR 0006). 모든 테이블은 account_id + RLS.
// 부서의 depth·path는 DB 트리거(마이그레이션 0004)가 계산·검증한다.
import { sql } from "drizzle-orm";
import {
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

/**
 * 사업자 (ORG-002~005). 삭제하지 않고 비활성화한다.
 *
 * @owner org
 */
export const business = pgTable(
  "business",
  {
    id: primaryId(),
    accountId: accountRef(),
    name: text().notNull(),
    /** 숫자 10자리 (하이픈 제거) */
    bizRegNo: text().notNull(),
    corpRegNo: text(),
    ceoName: text(),
    industry: text(),
    address: text(),
    phone: text(),
    /** 문서번호용 사업자 코드 */
    code: text().notNull(),
    sealKey: text(),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.accountId, t.bizRegNo),
    unique().on(t.accountId, t.code),
    unique("business_id_account_unique").on(t.id, t.accountId),
  ],
);

/**
 * 부서 트리 (ORG-010~015). depth·path는 트리거가 계산한다 (path = 조상 id를 `/`로 이은 값).
 *
 * @owner org
 */
export const department = pgTable(
  "department",
  {
    id: primaryId(),
    accountId: accountRef(),
    businessId: uuid().notNull(),
    parentId: uuid(),
    depth: integer().notNull().default(1),
    path: text().notNull().default(""),
    code: text().notNull(),
    name: text().notNull(),
    shortName: text(),
    headMembershipId: uuid(),
    sort: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    validFrom: date(),
    validTo: date(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.businessId, t.code),
    unique("department_id_account_unique").on(t.id, t.accountId),
    foreignKey({
      columns: [t.businessId, t.accountId],
      foreignColumns: [business.id, business.accountId],
    }),
    foreignKey({
      columns: [t.headMembershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }),
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id] }),
    index().on(t.businessId),
    index().on(t.parentId),
    index().on(t.path),
    check("department_depth_range", sql`${t.depth} between 1 and 5`),
  ],
);

/**
 * 직위 마스터 (ORG-030). rank가 클수록 상위
 *
 * @owner org
 */
export const position = pgTable(
  "position",
  {
    id: primaryId(),
    accountId: accountRef(),
    name: text().notNull(),
    rank: integer().notNull(),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.accountId, t.name),
    unique("position_id_account_unique").on(t.id, t.accountId),
  ],
);

/**
 * 직책 마스터 (ORG-031)
 *
 * @owner org
 */
export const duty = pgTable(
  "duty",
  {
    id: primaryId(),
    accountId: accountRef(),
    name: text().notNull(),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.accountId, t.name), unique("duty_id_account_unique").on(t.id, t.accountId)],
);

/**
 * 소속·겸직 (ORG-032·033). 유효한(valid_to 없는) 주소속은 구성원당 1개
 *
 * @owner org
 */
export const assignment = pgTable(
  "assignment",
  {
    id: primaryId(),
    accountId: accountRef(),
    membershipId: uuid().notNull(),
    businessId: uuid().notNull(),
    departmentId: uuid().notNull(),
    positionId: uuid(),
    dutyId: uuid(),
    isPrimary: boolean().notNull().default(false),
    validFrom: timestamp({ withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.membershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.businessId, t.accountId],
      foreignColumns: [business.id, business.accountId],
    }),
    foreignKey({
      columns: [t.departmentId, t.accountId],
      foreignColumns: [department.id, department.accountId],
    }),
    foreignKey({
      columns: [t.positionId, t.accountId],
      foreignColumns: [position.id, position.accountId],
    }),
    foreignKey({
      columns: [t.dutyId, t.accountId],
      foreignColumns: [duty.id, duty.accountId],
    }),
    uniqueIndex("assignment_one_primary")
      .on(t.membershipId)
      .where(sql`${t.isPrimary} and ${t.validTo} is null`),
    index().on(t.membershipId),
    index().on(t.departmentId),
  ],
);

/**
 * 발령 이력 (ORG-035). 추가만 가능
 *
 * @owner org
 */
export const assignmentHistory = pgTable(
  "assignment_history",
  {
    id: primaryId(),
    accountId: accountRef(),
    membershipId: uuid().notNull(),
    assignmentId: uuid(),
    /** create · update · end */
    action: text().notNull(),
    changes: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    effectiveDate: date().notNull(),
    reason: text(),
    actorUserId: uuid().references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.membershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }).onDelete("cascade"),
    index().on(t.membershipId),
  ],
);

/**
 * 역할 부여 (PERM-001). 소유자·계정 관리자는 membership.role이며 여기에 넣지 않는다
 *
 * @owner org
 */
export const roleGrant = pgTable(
  "role_grant",
  {
    id: primaryId(),
    accountId: accountRef(),
    membershipId: uuid().notNull(),
    /** business_admin · approval_admin · auditor · hr_admin */
    role: text().notNull(),
    scopeType: text({ enum: ["account", "business", "department"] }).notNull(),
    /** 계정 범위면 null */
    scopeId: uuid(),
    createdBy: uuid().references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.membershipId, t.accountId],
      foreignColumns: [membership.id, membership.accountId],
    }).onDelete("cascade"),
    uniqueIndex("role_grant_unique").on(
      t.membershipId,
      t.role,
      t.scopeType,
      sql`coalesce(${t.scopeId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    check("role_grant_scope_id", sql`(${t.scopeType} = 'account') = (${t.scopeId} is null)`),
    index().on(t.membershipId),
  ],
);

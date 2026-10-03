// 개인·부서·감사 문서함 (PRD APV-080·081). 결재 대기는 inbox.ts의 listPending이 맡는다.
// 각 함의 조건은 PERM-003의 열람 범위를 넘지 않는다: 문서함에 보이는 문서는 열 수 있는 문서다.
import type { Actor } from "@fmerp/core";
import { can } from "@fmerp/core";
import { schema } from "@fmerp/db";
import { and, eq, or, type SQL, sql } from "drizzle-orm";
import { businessTarget } from "../org-access";
import type { ServiceContext } from "./context";
import { ApprovalError } from "./errors";

export const MAILBOXES = [
  "mine",
  "upcoming",
  "progress",
  "completed",
  "cc",
  "receive",
  "circulate",
  "post",
  "dept",
  "audit",
] as const;
export type Mailbox = (typeof MAILBOXES)[number];

const MAX_LIMIT = 100;

interface Viewer {
  membershipId: string;
  actor: Actor;
}

const D = schema.document;
const S = schema.approvalStep;
const R = schema.documentRecipient;

/** 내가 처리자이거나 대결자인 단계 조건 (approval_step s) */
const meOnStep = (me: string) =>
  sql`(${me}::uuid = any(${S.assigneeIds}) or exists (select 1 from jsonb_each_text(${S.delegates}) d where d.value = ${me}))`;

/** 문서 d에서 내가 기안자이거나 결재선 참여자인 조건 */
const involved = (me: string) =>
  sql`(${D.drafterMembershipId} = ${me}::uuid or exists (select 1 from ${S} where ${S.documentId} = ${D.id} and ${meOnStep(me)}))`;

const myDepartments = (me: string) =>
  sql`(select ad.department_id from assignment ad where ad.membership_id = ${me}::uuid and ad.valid_to is null)`;

/** 수신 건 r에 대해 내가 받는 사람인가: 접수 전엔 접수 담당자, 접수 후엔 부서원(일반) 또는 접수자 */
const receiveVisible = (me: string) => sql`(
  ${R.kind} = 'receive' and ${D.status} = 'COMPLETED' and (
    (${R.receivedByMembershipId} is null and ${me}::uuid = coalesce(${R.assigneeMembershipId},
      (select dp.head_membership_id from department dp where dp.id = ${R.targetDepartmentId})))
    or (${R.receivedByMembershipId} is not null and (
      ${R.receivedByMembershipId} = ${me}::uuid
      or (${D.securityLevel} = 'normal' and ${R.targetDepartmentId} in ${myDepartments(me)})))
  )
)`;

function boxCondition(box: Exclude<Mailbox, "audit">, me: string): SQL {
  switch (box) {
    case "mine":
      return sql`${D.drafterMembershipId} = ${me}::uuid`;
    case "upcoming":
      // 앞으로 내 차례: 내가 처리 전(PENDING) 단계에 있고 지금 내 차례(ACTIVE·HELD)는 아닌 진행 중 문서
      return sql`${D.status} in ('IN_PROGRESS', 'ON_HOLD') and exists (
        select 1 from ${S} where ${S.documentId} = ${D.id} and ${S.status} = 'PENDING' and ${meOnStep(me)})
        and not exists (
        select 1 from ${S} where ${S.documentId} = ${D.id} and ${S.status} in ('ACTIVE', 'HELD') and ${meOnStep(me)})`;
    case "progress":
      return sql`${D.status} in ('IN_PROGRESS', 'ON_HOLD') and ${involved(me)}`;
    case "completed":
      return sql`${D.status} = 'COMPLETED' and ${involved(me)}`;
    case "cc":
      return sql`exists (select 1 from ${R} where ${R.documentId} = ${D.id} and ${R.kind} = 'cc'
        and (${R.targetMembershipId} = ${me}::uuid or ${R.targetDepartmentId} in ${myDepartments(me)})
        and (${D.status} = 'COMPLETED'
          or (${D.status} in ('IN_PROGRESS', 'ON_HOLD') and coalesce((
            select fv.recipients ->> 'ccVisibleFrom' from form_version fv where fv.id = ${D.formVersionId}), 'submit') <> 'complete')))`;
    case "receive":
      return sql`exists (select 1 from ${R} where ${R.documentId} = ${D.id} and ${receiveVisible(me)})`;
    case "circulate":
      return sql`${D.status} = 'COMPLETED' and exists (select 1 from ${R} where ${R.documentId} = ${D.id}
        and ${R.kind} = 'circulate'
        and (${R.targetMembershipId} = ${me}::uuid or ${R.targetDepartmentId} in ${myDepartments(me)}))`;
    case "post":
      // 후결 대기 중인 내 단계, 그리고 내 대신 대결로 처리된 문서(후열)
      return sql`(exists (select 1 from ${S} where ${S.documentId} = ${D.id} and ${S.type} = 'post'
          and ${S.status} = 'POST_PENDING' and ${meOnStep(me)})
        or exists (select 1 from approval_action aa where aa.document_id = ${D.id}
          and aa.on_behalf_of_membership_id = ${me}::uuid))`;
    case "dept":
      // 내 부서에서 기안한 완료 문서 중 내가 열 수 있는 것과, 내 부서가 접수한 수신 문서
      return sql`${D.status} = 'COMPLETED' and (
        (${involved(me)} and exists (select 1 from assignment da where da.membership_id = ${D.drafterMembershipId}
          and da.valid_to is null and da.department_id in ${myDepartments(me)}))
        or exists (select 1 from ${R} where ${R.documentId} = ${D.id} and ${receiveVisible(me)}
          and ${R.receivedByMembershipId} is not null))`;
  }
}

/** 감사함: 읽기 전용 감사 범위(read_all) 안의 상신된 문서 */
function auditCondition(viewer: Viewer, businessIds: string[]): SQL | null {
  const owner = can(viewer.actor, "document.read_all", { type: "account" });
  const businesses = businessIds.filter((id) =>
    can(viewer.actor, "document.read_all", businessTarget(id)),
  );
  const departments = viewer.actor.grants
    .filter((g) => g.role === "auditor" && g.scopeType === "department" && g.scopeId)
    .map((g) => g.scopeId as string);
  if (!owner && businesses.length === 0 && departments.length === 0) return null;
  const parts: SQL[] = [];
  if (owner) parts.push(sql`true`);
  if (businesses.length > 0) {
    parts.push(
      sql`${D.businessId} = any(array[${sql.join(
        businesses.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}])`,
    );
  }
  for (const id of departments) {
    parts.push(sql`exists (select 1 from assignment aa join department dd on dd.id = aa.department_id
      where aa.membership_id = ${D.drafterMembershipId} and aa.valid_to is null
        and dd.path like ${`%${id}%`})`);
  }
  return sql`${D.status} <> 'DRAFT' and (${sql.join(parts, sql` or `)})`;
}

export interface MailboxItem {
  id: string;
  title: string;
  docNo: string | null;
  status: string;
  urgent: boolean;
  securityLevel: string;
  drafterName: string;
  createdAt: Date;
  submittedAt: Date | null;
  completedAt: Date | null;
}

export interface MailboxPage {
  items: MailboxItem[];
  /** 다음 쪽이 있으면 그 시작 위치. 없으면 null */
  nextCursor: string | null;
}

const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");

function decodeCursor(cursor: string): { at: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const at = new Date(iso ?? "");
  if (!id || Number.isNaN(at.getTime())) {
    throw new ApprovalError("validation_failed", "잘못된 커서입니다");
  }
  return { at, id };
}

/** 쪽 나누기 조회: 최근 만든 순(created_at, id)의 키셋 페이지네이션이라 쪽이 깊어져도 느려지지 않는다 (NFR-P03) */
export async function pageDocuments(
  ctx: ServiceContext,
  where: (SQL | undefined)[],
  opts: { limit?: number; cursor?: string } = {},
): Promise<MailboxPage> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), MAX_LIMIT);
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  const rows = await ctx.tx
    .select({
      id: D.id,
      title: D.title,
      docNo: D.docNo,
      status: D.status,
      urgent: D.urgent,
      securityLevel: D.securityLevel,
      drafterName: schema.user.name,
      createdAt: D.createdAt,
      submittedAt: D.submittedAt,
      completedAt: D.completedAt,
    })
    .from(D)
    .innerJoin(schema.membership, eq(schema.membership.id, D.drafterMembershipId))
    .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId))
    .where(
      and(
        ...where,
        cursor
          ? or(
              sql`${D.createdAt} < ${cursor.at.toISOString()}::timestamptz`,
              and(
                sql`${D.createdAt} = ${cursor.at.toISOString()}::timestamptz`,
                sql`${D.id} < ${cursor.id}::uuid`,
              ),
            )
          : undefined,
      ),
    )
    .orderBy(sql`${D.createdAt} desc`, sql`${D.id} desc`)
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

/** 내가 열람할 수 있는 문서 조건 (PERM-003): 기안자·결재선 참여자·참조·수신(접수 후)·공람·감사 범위. 초안은 기안자 본인만 */
export async function viewableCondition(ctx: ServiceContext, viewer: Viewer): Promise<SQL> {
  const me = viewer.membershipId;
  const businesses = await ctx.tx.select({ id: schema.business.id }).from(schema.business);
  const audit = auditCondition(
    viewer,
    businesses.map((b) => b.id),
  );
  const parts = [
    involved(me),
    boxCondition("cc", me),
    boxCondition("receive", me),
    boxCondition("circulate", me),
    ...(audit ? [audit] : []),
  ];
  return sql`(${D.drafterMembershipId} = ${me}::uuid or (${D.status} <> 'DRAFT' and (${sql.join(parts, sql` or `)})))`;
}

/** 문서함 한 쪽 */
export async function listMailbox(
  ctx: ServiceContext,
  box: Mailbox,
  viewer: Viewer,
  opts: { limit?: number; cursor?: string } = {},
): Promise<MailboxPage> {
  let condition: SQL | null;
  if (box === "audit") {
    const businesses = await ctx.tx.select({ id: schema.business.id }).from(schema.business);
    condition = auditCondition(
      viewer,
      businesses.map((b) => b.id),
    );
    // 감사 범위가 없으면 빈 목록이 아니라 접근 거부로 구분한다
    if (!condition) throw new ApprovalError("forbidden", "감사 범위가 없습니다");
  } else {
    condition = boxCondition(box, viewer.membershipId);
  }
  // 초안은 기안자 본인 함에만 나타난다
  return pageDocuments(
    ctx,
    [box === "mine" ? undefined : sql`${D.status} <> 'DRAFT'`, condition],
    opts,
  );
}

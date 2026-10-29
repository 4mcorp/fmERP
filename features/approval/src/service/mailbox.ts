// 개인·부서·감사 문서함 (PRD APV-080·081). 결재 대기는 inbox.ts의 listPending이 맡는다.
// 각 함의 조건은 PERM-003의 열람 범위를 넘지 않는다: 문서함에 보이는 문서는 열 수 있는 문서다.

import { schema } from "@fmerp/db";
import { businessTarget } from "@fmerp/shared/authz/org-access";
import type { Actor } from "@fmerp/shared/domain/permissions";
import { can } from "@fmerp/shared/domain/permissions";
import type { ServiceContext } from "@fmerp/shared/server/context";
import { decodeCursor, encodeCursor } from "@fmerp/shared/server/cursor";
import { ServiceError } from "@fmerp/shared/server/errors";
import { and, eq, inArray, or, type SQL, sql } from "drizzle-orm";

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

/** 문서함 목록 한 줄: 내가 열어 봤는지 (R8) */
interface MailboxListItem extends MailboxItem {
  read: boolean;
}

export interface MailboxListPage {
  items: MailboxListItem[];
  nextCursor: string | null;
}

/** 쪽 나누기용 내부 값. 응답에는 싣지 않는다 */
type ItemRow = MailboxItem & { cursorAt: string };
const toItem = ({ cursorAt: _cursorAt, ...item }: ItemRow): MailboxItem => item;

const SELECT_FIELDS = {
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
  cursorAt: sql<string>`to_char(${D.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
};

const cursorCondition = (cursor: { at: string; id: string } | null) =>
  cursor
    ? or(
        sql`${D.createdAt} < ${cursor.at}::timestamptz`,
        and(sql`${D.createdAt} = ${cursor.at}::timestamptz`, sql`${D.id} < ${cursor.id}::uuid`),
      )
    : undefined;

/** 쪽 나누기 조회: 최근 만든 순(created_at, id)의 키셋 페이지네이션이라 쪽이 깊어져도 느려지지 않는다 (NFR-P03) */
export async function pageDocuments(
  ctx: ServiceContext,
  where: (SQL | undefined)[],
  opts: { limit?: number; cursor?: string } = {},
): Promise<MailboxPage> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), MAX_LIMIT);
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  const rows = await ctx.tx
    .select(SELECT_FIELDS)
    .from(D)
    .innerJoin(schema.membership, eq(schema.membership.id, D.drafterMembershipId))
    .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId))
    .where(and(...where, cursorCondition(cursor)))
    .orderBy(sql`${D.createdAt} desc`, sql`${D.id} desc`)
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toItem),
    nextCursor: rows.length > limit && last ? encodeCursor(last.cursorAt, last.id) : null,
  };
}

const CHUNK_SIZE = 2000;
const MAX_CHUNKS = 25;

/**
 * 덩어리 조회: 최근 순으로 상신된 문서 CHUNK_SIZE건씩 훑으면서 조건에 맞는 것을 모은다. 조건이 흔해서 곧 채워지는
 * 경우(예: 모든 문서에 들어 있는 낱말)에 전체를 읽지 않고 멈추려는 용도다. 한 번에 MAX_CHUNKS 덩어리까지 보고,
 * 그래도 못 채우면 지금까지 찾은 것과 이어서 읽을 커서를 준다. 조건이 드문 경우는 호출자가 후보 id로 좁혀 pageDocuments를 쓴다.
 * 안쪽 덩어리를 `document`라는 이름의 CTE로 만들어 where 조건이 그대로 적용되게 한다.
 */
export async function pageDocumentsChunked(
  ctx: ServiceContext,
  where: (SQL | undefined)[],
  opts: { limit?: number; cursor?: string } = {},
): Promise<MailboxPage> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), MAX_LIMIT);
  let cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  const found: ItemRow[] = [];
  let nextCursor: string | null = null;

  for (let n = 0; n < MAX_CHUNKS; n++) {
    const chunkQuery = ctx.tx
      .select()
      .from(D)
      .where(and(sql`${D.status} <> 'DRAFT'`, cursorCondition(cursor)))
      .orderBy(sql`${D.createdAt} desc`, sql`${D.id} desc`)
      .limit(CHUNK_SIZE);
    const chunk = ctx.tx.$with("document").as(chunkQuery);
    const rows = await ctx.tx
      .with(chunk)
      .select(SELECT_FIELDS)
      .from(chunk)
      .innerJoin(schema.membership, eq(schema.membership.id, D.drafterMembershipId))
      .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId))
      .where(and(...where))
      .orderBy(sql`${D.createdAt} desc`, sql`${D.id} desc`)
      .limit(limit + 1 - found.length);
    found.push(...rows);
    if (found.length > limit) break;

    // 이번 덩어리에서 어디까지 읽었는지 (가장 오래된 문서)와 덩어리가 꽉 찼는지
    const [edge] = await ctx.tx
      .with(chunk)
      .select({
        n: sql<number>`count(*)::int`,
        at: sql<string>`to_char(min(${D.createdAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        id: sql<string>`(array_agg(${D.id} order by ${D.createdAt} asc, ${D.id} asc))[1]`,
      })
      .from(chunk);
    if (!edge || edge.n < CHUNK_SIZE) {
      cursor = null; // 끝까지 읽었다
      break;
    }
    cursor = { at: edge.at, id: edge.id };
    nextCursor = encodeCursor(cursor.at, cursor.id);
  }

  if (found.length > limit) {
    const page = found.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toItem),
      nextCursor: last ? encodeCursor(last.cursorAt, last.id) : null,
    };
  }
  return { items: found.map(toItem), nextCursor: cursor ? nextCursor : null };
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
): Promise<MailboxListPage> {
  let condition: SQL | null;
  if (box === "audit") {
    const businesses = await ctx.tx.select({ id: schema.business.id }).from(schema.business);
    condition = auditCondition(
      viewer,
      businesses.map((b) => b.id),
    );
    // 감사 범위가 없으면 빈 목록이 아니라 접근 거부로 구분한다
    if (!condition) throw new ServiceError("forbidden", "감사 범위가 없습니다");
  } else {
    condition = boxCondition(box, viewer.membershipId);
  }
  // 초안은 기안자 본인 함에만 나타난다
  const page = await pageDocuments(
    ctx,
    [box === "mine" ? undefined : sql`${D.status} <> 'DRAFT'`, condition],
    opts,
  );
  const opened = await openedIdsOf(
    ctx,
    box,
    viewer.membershipId,
    page.items.map((i) => i.id),
  );
  return {
    nextCursor: page.nextCursor,
    items: page.items.map((i) => ({ ...i, read: opened.has(i.id) })),
  };
}

/**
 * 결재 문서를 상세로 연 기록 (R8 읽음 표시). 감사 로그가 아니다(열람 감사는 기존 경로).
 * 같은 사람이 다시 열면 첫 열람 일시는 두고 마지막 열람 일시만 갱신한다.
 */
export async function recordDocumentView(
  ctx: ServiceContext,
  documentId: string,
  membershipId: string,
) {
  await ctx.tx
    .insert(schema.documentView)
    .values({
      accountId: ctx.accountId,
      documentId,
      membershipId,
      firstViewedAt: ctx.now,
      lastViewedAt: ctx.now,
    })
    .onConflictDoUpdate({
      target: [schema.documentView.documentId, schema.documentView.membershipId],
      set: { lastViewedAt: ctx.now },
    });
}

/**
 * 이 쪽 문서 가운데 내가 연 문서 id. 참조·공람 함은 수신 대상별 열람 표(document_recipient_read)를,
 * 그 밖의 결재 함은 문서 열람 표(document_view)를 본다.
 */
async function openedIdsOf(
  ctx: ServiceContext,
  box: Mailbox,
  me: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  if (box === "cc" || box === "circulate") {
    const rows = await ctx.tx
      .selectDistinct({ documentId: R.documentId })
      .from(schema.documentRecipientRead)
      .innerJoin(R, eq(R.id, schema.documentRecipientRead.recipientId))
      .where(and(eq(schema.documentRecipientRead.membershipId, me), inArray(R.documentId, ids)));
    return new Set(rows.map((r) => r.documentId));
  }
  const rows = await ctx.tx
    .select({ documentId: schema.documentView.documentId })
    .from(schema.documentView)
    .where(
      and(eq(schema.documentView.membershipId, me), inArray(schema.documentView.documentId, ids)),
    );
  return new Set(rows.map((r) => r.documentId));
}

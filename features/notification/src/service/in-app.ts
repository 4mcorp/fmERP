// 인앱 알림 조회·읽음 처리 (PRD NTF-002). 본인 알림만 다룬다. 호출자가 withTenant로 테넌트를 정한다.

import { schema, type Tx } from "@fmerp/db";
import { ApiError } from "@fmerp/shared/server/http";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { type NotificationKind, notificationPath } from "../domain/notification-rules";

/** 현재 테넌트 안의 내 구성원 id (RLS가 계정을 좁혀 준다) */
export async function myMembershipId(tx: Tx, userId: string): Promise<string> {
  const [m] = await tx
    .select({ id: schema.membership.id })
    .from(schema.membership)
    .where(eq(schema.membership.userId, userId));
  if (!m) throw new ApiError(403, "forbidden", "권한이 없습니다");
  return m.id;
}

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  documentId: string | null;
  /** 눌렀을 때 이동할 경로 */
  href: string;
  readAt: string | null;
  createdAt: string;
}

export async function listNotifications(
  tx: Tx,
  membershipId: string,
  opts: { limit: number; cursor?: string; unreadOnly: boolean },
): Promise<{ items: NotificationItem[]; nextCursor: string | null }> {
  const N = schema.notification;
  // id는 uuidv7이라 id 내림차순이 최신순이다. 커서는 마지막 id
  const rows = await tx
    .select()
    .from(N)
    .where(
      and(
        eq(N.recipientMembershipId, membershipId),
        opts.unreadOnly ? isNull(N.readAt) : undefined,
        opts.cursor ? lt(N.id, opts.cursor) : undefined,
      ),
    )
    .orderBy(desc(N.id))
    .limit(opts.limit + 1);
  const page = rows.slice(0, opts.limit);
  return {
    items: page.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      documentId: r.documentId,
      href: notificationPath(r.kind as NotificationKind, r.documentId),
      readAt: r.readAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: rows.length > opts.limit ? (page.at(-1)?.id ?? null) : null,
  };
}

export async function unreadCount(tx: Tx, membershipId: string): Promise<number> {
  const N = schema.notification;
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(N)
    .where(and(eq(N.recipientMembershipId, membershipId), isNull(N.readAt)));
  return row?.n ?? 0;
}

/** 읽음 표시. 남의 알림이거나 없는 알림이면 404 (존재를 알리지 않는다) */
export async function markRead(tx: Tx, membershipId: string, id: string, now: Date): Promise<void> {
  const N = schema.notification;
  const [exists] = await tx
    .select({ id: N.id })
    .from(N)
    .where(and(eq(N.id, id), eq(N.recipientMembershipId, membershipId)));
  if (!exists) throw new ApiError(404, "not_found", "찾을 수 없습니다");
  await tx
    .update(N)
    .set({ readAt: now })
    .where(and(eq(N.id, id), isNull(N.readAt)));
}

export async function markAllRead(tx: Tx, membershipId: string, now: Date): Promise<void> {
  const N = schema.notification;
  await tx
    .update(N)
    .set({ readAt: now })
    .where(and(eq(N.recipientMembershipId, membershipId), isNull(N.readAt)));
}

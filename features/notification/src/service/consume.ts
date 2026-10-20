// 결재 이벤트(outbox) → 인앱 알림 (M8 plan). 이벤트마다 한 트랜잭션에서 알림을 만들고 처리 표시를 남긴다.
// 같은 이벤트를 두 번 처리해도 알림은 한 번만 생긴다(수신자·dedupe_key 유니크).

import { type Db, schema, withTenant } from "@fmerp/db";
import type { ApprovalEvent } from "@fmerp/shared/domain/approval-event";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { notificationsForEvent } from "../domain/notification-rules";

type PendingEvent = {
  event_id: string;
  account_id: string;
  document_id: string;
  type: string;
};

export interface CreatedNotification {
  id: string;
  accountId: string;
}

/** 아직 알림 처리 표시가 없는 최근 7일의 결재 이벤트의 위치 (계정을 가로지르는 DB 함수. 내용은 돌려주지 않는다) */
async function pendingEvents(appDb: Db, limit = 100): Promise<PendingEvent[]> {
  const result = await appDb.execute<PendingEvent>(
    sql`select * from notification_pending_events(${limit}, interval '7 days')`,
  );
  return result.rows;
}

/** 이벤트 하나를 처리한다. 새로 만든 알림 목록(텔레그램 발송 대상)을 돌려준다 */
/** `telegram`이 false이면(봇 토큰 없음) 텔레그램 발송 대상으로 표시하지 않는다 */
async function processEvent(
  appDb: Db,
  event: PendingEvent,
  telegram = true,
): Promise<CreatedNotification[]> {
  return withTenant(appDb, event.account_id, async (tx) => {
    // 이벤트 내용(반려 의견·결재선 변경 사유 포함)은 테넌트를 지정한 이 트랜잭션에서만 읽는다
    const [row] = await tx
      .select({ payload: schema.approvalEvent.payload })
      .from(schema.approvalEvent)
      .where(eq(schema.approvalEvent.id, event.event_id));
    const payload = row?.payload as unknown as ApprovalEvent | undefined;
    const [doc] = await tx
      .select({
        title: schema.document.title,
        drafterId: schema.document.drafterMembershipId,
      })
      .from(schema.document)
      .where(eq(schema.document.id, event.document_id));

    const created: CreatedNotification[] = [];
    if (doc && payload) {
      const [drafter] = await tx
        .select({ name: schema.user.name })
        .from(schema.membership)
        .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId))
        .where(eq(schema.membership.id, doc.drafterId));
      const steps = await tx
        .select({ id: schema.approvalStep.id, assigneeIds: schema.approvalStep.assigneeIds })
        .from(schema.approvalStep)
        .where(eq(schema.approvalStep.documentId, event.document_id));
      const stepAssignees = Object.fromEntries(steps.map((s) => [s.id, s.assigneeIds]));

      let recipientIds: string[] = [];
      if (event.type === "completed") {
        const rows = await tx
          .select({
            target: schema.documentRecipient.targetMembershipId,
            assignee: schema.documentRecipient.assigneeMembershipId,
          })
          .from(schema.documentRecipient)
          .where(eq(schema.documentRecipient.documentId, event.document_id));
        // 부서 대상 수신은 담당자(assignee)가 정해졌을 때만 개인 알림 대상이 된다
        recipientIds = rows.flatMap((r) => [r.target, r.assignee]).filter((id) => id !== null);
      }

      const drafts = notificationsForEvent(payload, {
        docTitle: doc.title,
        drafterId: doc.drafterId,
        drafterName: drafter?.name ?? "알 수 없음",
        stepAssignees,
        recipientIds,
      });

      // 퇴사한 구성원에게는 만들지 않는다
      const ids = [...new Set(drafts.map((d) => d.recipientId))];
      const active =
        ids.length === 0
          ? []
          : await tx
              .select({ id: schema.membership.id })
              .from(schema.membership)
              .where(and(inArray(schema.membership.id, ids), ne(schema.membership.status, "left")));
      const activeIds = new Set(active.map((m) => m.id));

      const values = drafts
        .filter((d) => activeIds.has(d.recipientId))
        .map((d) => ({
          accountId: event.account_id,
          recipientMembershipId: d.recipientId,
          kind: d.kind,
          documentId: d.documentId,
          title: d.title,
          body: d.body,
          externalText: d.external,
          dedupeKey: `${event.event_id}:${d.kind}`,
          telegramStatus: telegram ? ("PENDING" as const) : ("NONE" as const),
        }));
      if (values.length > 0) {
        const rows = await tx
          .insert(schema.notification)
          .values(values)
          .onConflictDoNothing()
          .returning({ id: schema.notification.id, accountId: schema.notification.accountId });
        created.push(...rows);
      }
    }
    await tx
      .insert(schema.eventNotified)
      .values({ eventId: event.event_id, accountId: event.account_id })
      .onConflictDoNothing();
    return created;
  });
}

export interface ConsumeOptions {
  telegram: boolean;
  /** 새로 만든 알림. 채널(텔레그램·웹 푸시)별 발송 큐 등록은 호출하는 쪽이 정한다 */
  onCreated: (created: CreatedNotification[]) => Promise<void>;
  onError: (event: PendingEvent, error: unknown) => void;
  limit?: number;
}

/**
 * 대기 중인 이벤트를 모두(limit까지) 처리한다. 한 이벤트가 실패해도 다음 이벤트를 계속하고,
 * 실패한 이벤트는 처리 표시가 없으므로 다음 호출에서 다시 시도된다.
 */
export async function consumeEvents(appDb: Db, o: ConsumeOptions): Promise<number> {
  const events = await pendingEvents(appDb, o.limit ?? 100);
  let done = 0;
  for (const event of events) {
    try {
      const created = await processEvent(appDb, event, o.telegram);
      done += 1;
      if (created.length > 0) await o.onCreated(created);
    } catch (error) {
      o.onError(event, error);
    }
  }
  return done;
}

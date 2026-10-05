// 인앱 알림 한 건을 텔레그램으로 보낸다 (M8 plan). 재시도는 호출하는 쪽(pg-boss)이 맡고,
// 이 함수는 영구 실패(연결 없음·차단)를 SKIPPED로, 재시도할 오류를 던져서 알린다.
import { type NotificationKind, notificationPath } from "@fmerp/core";
import { type Db, schema, withTenant } from "@fmerp/db";
import { and, eq, sql } from "drizzle-orm";
import { findChatId, unlinkTelegram } from "./link";
import { TelegramApiError, type TelegramClient } from "./telegram-api";

export interface SendDeps {
  appDb: Db;
  authDb: Db;
  client: Pick<TelegramClient, "sendMessage">;
  /** 알림 링크의 기준 주소 (예: https://erp.example.com). 끝의 /는 무시한다 */
  baseUrl: string;
}

export type SendOutcome = "sent" | "skipped" | "not_pending";

export function notificationLink(
  baseUrl: string,
  kind: NotificationKind,
  documentId: string | null,
) {
  return `${baseUrl.replace(/\/$/, "")}${notificationPath(kind, documentId)}`;
}

/**
 * 보낸다. 일시 오류(네트워크·429·5xx)는 그대로 던지고, `lastAttempt`이면 FAILED로 표시한 뒤 던진다.
 * 문서 제목·내용은 보내지 않는다. 저장된 외부 문구와 링크만 보낸다.
 */
export async function sendTelegramNotification(
  deps: SendDeps,
  job: { accountId: string; notificationId: string },
  lastAttempt: boolean,
): Promise<SendOutcome> {
  const { appDb, authDb, client } = deps;
  const row = await withTenant(appDb, job.accountId, async (tx) => {
    const [n] = await tx
      .select({
        status: schema.notification.telegramStatus,
        text: schema.notification.externalText,
        documentId: schema.notification.documentId,
        kind: schema.notification.kind,
        userId: schema.membership.userId,
      })
      .from(schema.notification)
      .innerJoin(
        schema.membership,
        eq(schema.membership.id, schema.notification.recipientMembershipId),
      )
      .where(eq(schema.notification.id, job.notificationId));
    return n;
  });
  if (row?.status !== "PENDING") return "not_pending";

  const setStatus = (status: "SENT" | "SKIPPED" | "FAILED") =>
    withTenant(appDb, job.accountId, (tx) =>
      tx
        .update(schema.notification)
        .set({ telegramStatus: status })
        .where(
          and(
            eq(schema.notification.id, job.notificationId),
            eq(schema.notification.telegramStatus, "PENDING"),
          ),
        ),
    );

  const chatId = await findChatId(authDb, row.userId);
  if (chatId === null) {
    await setStatus("SKIPPED");
    return "skipped";
  }
  const text = `${row.text}\n${notificationLink(deps.baseUrl, row.kind, row.documentId)}`;
  try {
    await client.sendMessage(chatId, text);
  } catch (error) {
    if (error instanceof TelegramApiError && error.isGone) {
      // 사용자가 봇을 차단했거나 대화가 사라졌다: 연결을 풀고 다시 보내지 않는다
      await unlinkTelegram(authDb, row.userId);
      await setStatus("SKIPPED");
      return "skipped";
    }
    if (lastAttempt) await setStatus("FAILED");
    throw error;
  }
  await setStatus("SENT");
  return "sent";
}

/** 발송이 아직 끝나지 않은 알림 id (큐 등록 누락 보정). 계정을 가로지르는 DB 함수로 id만 읽는다 */
export async function pendingTelegram(
  appDb: Db,
  olderThanSeconds: number,
  limit = 100,
): Promise<{ accountId: string; notificationId: string }[]> {
  const result = await appDb.execute<{ notification_id: string; account_id: string }>(
    sql`select * from notification_pending_telegram(${limit}, make_interval(secs => ${olderThanSeconds}))`,
  );
  return result.rows.map((r) => ({ accountId: r.account_id, notificationId: r.notification_id }));
}

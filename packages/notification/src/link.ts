// 텔레그램 연결 (M8 plan): 일회용 토큰 발급·소비와 수신한 업데이트 처리.
// 수신 방식(폴링·웹훅)과 무관하게 processUpdate 한 곳을 거친다. 인증 DB(fmerp_auth) 연결로 동작한다.
import { createHash, randomBytes } from "node:crypto";
import { recordAudit } from "@fmerp/audit";
import { type Db, schema } from "@fmerp/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { TelegramClient, TelegramUpdate } from "./telegram-api";

export const LINK_TOKEN_TTL_MS = 10 * 60 * 1000;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** 연결 링크용 토큰을 만든다. 이전에 발급한 미사용 토큰은 무효가 된다. 원문은 이 반환값에만 있다 */
export async function createLinkToken(authDb: Db, userId: string, now: Date) {
  const token = randomBytes(24).toString("base64url");
  await authDb.transaction(async (tx) => {
    await tx
      .update(schema.telegramLinkToken)
      .set({ usedAt: now })
      .where(
        and(eq(schema.telegramLinkToken.userId, userId), isNull(schema.telegramLinkToken.usedAt)),
      );
    await tx.insert(schema.telegramLinkToken).values({
      userId,
      tokenHash: hash(token),
      expiresAt: new Date(now.getTime() + LINK_TOKEN_TTL_MS),
    });
  });
  return { token, expiresAt: new Date(now.getTime() + LINK_TOKEN_TTL_MS) };
}

/**
 * 토큰이 유효하면(미사용·미만료) 사용 처리하고 사용자와 대화를 묶는다. 한 번만 성공한다.
 * 같은 대화가 다른 사용자에게 묶여 있었다면 그 연결은 끊어진다(대화 하나는 한 사용자에게만).
 */
export async function consumeLinkToken(authDb: Db, token: string, chatId: number, now: Date) {
  return authDb.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.telegramLinkToken)
      .set({ usedAt: now })
      .where(
        and(
          eq(schema.telegramLinkToken.tokenHash, hash(token)),
          isNull(schema.telegramLinkToken.usedAt),
          gt(schema.telegramLinkToken.expiresAt, now),
        ),
      )
      .returning({ userId: schema.telegramLinkToken.userId });
    if (!row) return null;
    await tx.delete(schema.telegramLink).where(eq(schema.telegramLink.chatId, chatId));
    await tx
      .insert(schema.telegramLink)
      .values({ userId: row.userId, chatId, linkedAt: now })
      .onConflictDoUpdate({
        target: schema.telegramLink.userId,
        set: { chatId, linkedAt: now },
      });
    return { userId: row.userId };
  });
}

export async function findChatId(authDb: Db, userId: string): Promise<number | null> {
  const [row] = await authDb
    .select({ chatId: schema.telegramLink.chatId })
    .from(schema.telegramLink)
    .where(eq(schema.telegramLink.userId, userId));
  return row?.chatId ?? null;
}

export async function unlinkTelegram(authDb: Db, userId: string): Promise<void> {
  await authDb.delete(schema.telegramLink).where(eq(schema.telegramLink.userId, userId));
}

const START = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{16,64}))?\s*$/;

export const MESSAGES = {
  linked: "연결되었습니다. 이제 결재 알림을 이 대화로 보내 드립니다.",
  invalid: "연결 링크가 만료되었거나 이미 사용되었습니다. 4mERP '내 정보'에서 다시 연결해 주세요.",
  guide: "4mERP '내 정보'의 '텔레그램 연결'에서 만든 링크로 시작해 주세요.",
} as const;

export interface ProcessDeps {
  authDb: Db;
  client: Pick<TelegramClient, "sendMessage">;
  now: () => Date;
}

export type UpdateOutcome = "linked" | "invalid" | "guide" | "ignored";

/**
 * 수신한 업데이트 하나를 처리한다. 개인 대화에서 온 `/start <토큰>`만 의미가 있고 나머지는 무시한다.
 * 메시지 내용은 로그에 남기지 않는다. 답장 실패는 연결 결과에 영향을 주지 않는다.
 */
export async function processUpdate(
  update: TelegramUpdate,
  deps: ProcessDeps,
): Promise<UpdateOutcome> {
  const message = update.message;
  if (!message?.text || message.chat.type !== "private" || message.from?.is_bot) return "ignored";
  const match = START.exec(message.text.trim());
  if (!match) return "ignored";
  const chatId = message.chat.id;
  const reply = (text: string) => deps.client.sendMessage(chatId, text).catch(() => undefined);
  const token = match[1];
  if (!token) {
    await reply(MESSAGES.guide);
    return "guide";
  }
  const linked = await consumeLinkToken(deps.authDb, token, chatId, deps.now());
  if (!linked) {
    await reply(MESSAGES.invalid);
    return "invalid";
  }
  // 알림이 가는 곳이 바뀌므로 연결이 완료된 것도 감사 로그에 남긴다 (요청만 남기면 누가 연결했는지 모른다)
  await recordAudit(deps.authDb, {
    accountId: null,
    actorUserId: linked.userId,
    action: "notification.telegram_linked",
    target: { type: "user", id: linked.userId },
    result: "success",
    request: {},
  }).catch(() => undefined);
  await reply(MESSAGES.linked);
  return "linked";
}

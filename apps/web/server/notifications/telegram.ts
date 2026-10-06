// 텔레그램 연결·웹훅 수신·수신 방식 설정 (M8 plan). 연결과 수신 방식은 사용자·서버 단위라 테넌트와 무관하다.
import { computeAuditDiff, recordAudit } from "@fmerp/audit";
import {
  createLinkToken,
  findChatId,
  getReceiverMode,
  getReceiverStatus,
  processUpdate,
  type ReceiverMode,
  safeErrorText,
  setReceiverMode,
  TelegramClient,
  type TelegramUpdate,
  unlinkTelegram,
  verifyWebhookSecret,
  type WebhookInfo,
} from "@fmerp/notification";
import type { SessionInfo } from "@fmerp/shared/contracts/system-guards";
import type { ServerDeps } from "@fmerp/shared/server/deps";
import { getEnv } from "@fmerp/shared/server/env";
import { ApiError } from "@fmerp/shared/server/http";

type RequestCtx = { ip?: string | null; userAgent?: string | null; requestId?: string | null };

/** 봇 토큰이 설정되어 있을 때만 클라이언트를 만든다 */
export function telegramClient(): TelegramClient | null {
  const env = getEnv();
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  return new TelegramClient({ token: env.TELEGRAM_BOT_TOKEN, baseUrl: env.TELEGRAM_API_BASE_URL });
}

/** 웹훅을 켤 수 있는 환경인지: 공개 https 주소와 비밀 값이 있어야 한다 */
export function webhookReady(): boolean {
  const env = getEnv();
  return (
    Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET) &&
    env.BETTER_AUTH_URL.startsWith("https://")
  );
}

export interface MyTelegram {
  /** 서버에 봇이 설정되어 있는지 (아니면 연결 버튼을 숨긴다) */
  enabled: boolean;
  linked: boolean;
}

export async function getMyTelegram(d: ServerDeps, userId: string): Promise<MyTelegram> {
  const env = getEnv();
  const enabled = Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME);
  return { enabled, linked: enabled ? (await findChatId(d.authDb, userId)) !== null : false };
}

export async function createMyLink(
  d: ServerDeps,
  session: SessionInfo,
  request: RequestCtx,
): Promise<{ url: string; expiresAt: string }> {
  const env = getEnv();
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_BOT_USERNAME) {
    throw new ApiError(409, "telegram_disabled", "텔레그램 알림이 설정되지 않았습니다");
  }
  const { token, expiresAt } = await createLinkToken(d.authDb, session.userId, d.now());
  await recordAudit(d.authDb, {
    accountId: null,
    actorUserId: session.userId,
    action: "notification.telegram_link_request",
    target: { type: "user", id: session.userId },
    result: "success",
    request,
  });
  return {
    url: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function unlinkMyTelegram(
  d: ServerDeps,
  session: SessionInfo,
  request: RequestCtx,
): Promise<void> {
  await unlinkTelegram(d.authDb, session.userId);
  await recordAudit(d.authDb, {
    accountId: null,
    actorUserId: session.userId,
    action: "notification.telegram_unlink",
    target: { type: "user", id: session.userId },
    result: "success",
    request,
  });
}

/**
 * 텔레그램이 보낸 웹훅 요청 처리. 비밀 헤더가 맞지 않거나 웹훅이 설정되지 않았으면 존재를 알리지 않는다(404).
 * 처리 중 오류가 나도 텔레그램에는 200을 돌려 같은 업데이트가 무한 재전송되지 않게 한다.
 */
export async function handleWebhook(
  d: ServerDeps,
  secretHeader: string | undefined,
  update: TelegramUpdate,
): Promise<void> {
  const env = getEnv();
  const client = telegramClient();
  if (!client || !env.TELEGRAM_WEBHOOK_SECRET) {
    throw new ApiError(404, "not_found", "찾을 수 없습니다");
  }
  if (!verifyWebhookSecret(env.TELEGRAM_WEBHOOK_SECRET, secretHeader)) {
    throw new ApiError(404, "not_found", "찾을 수 없습니다");
  }
  try {
    await processUpdate(update, { authDb: d.authDb, client, now: d.now });
  } catch (error) {
    // 오류 객체 전체(SQL·파라미터)는 남기지 않는다
    console.error(`[telegram] 웹훅 업데이트 처리 실패: ${safeErrorText(error)}`);
  }
}

export interface SystemTelegram {
  configured: {
    botToken: boolean;
    botUsername: boolean;
    webhookSecret: boolean;
    /** 웹훅을 켤 수 있는 환경(공개 https 주소 + 비밀 값)인지 */
    webhookReady: boolean;
    publicBaseUrl: string;
  };
  /** 관리자가 고른 수신 방식 */
  mode: ReceiverMode;
  /** worker가 실제로 적용한 수신 방식과 마지막 오류 */
  applied: { mode: ReceiverMode | null; error: string | null; at: string } | null;
  /** 텔레그램에 등록된 웹훅 상태 (토큰이 없거나 조회 실패 시 null) */
  webhook: WebhookInfo | null;
}

export async function getSystemTelegram(d: ServerDeps): Promise<SystemTelegram> {
  const env = getEnv();
  const client = telegramClient();
  let webhook: WebhookInfo | null = null;
  if (client) webhook = await client.getWebhookInfo().catch(() => null);
  return {
    configured: {
      botToken: Boolean(env.TELEGRAM_BOT_TOKEN),
      botUsername: Boolean(env.TELEGRAM_BOT_USERNAME),
      webhookSecret: Boolean(env.TELEGRAM_WEBHOOK_SECRET),
      webhookReady: webhookReady(),
      publicBaseUrl: env.BETTER_AUTH_URL,
    },
    mode: await getReceiverMode(d.appDb),
    applied: await getReceiverStatus(d.appDb),
    webhook,
  };
}

export async function changeReceiverMode(
  d: ServerDeps,
  session: SessionInfo,
  mode: ReceiverMode,
  request: RequestCtx,
): Promise<void> {
  if (mode === "webhook" && !webhookReady()) {
    throw new ApiError(
      409,
      "webhook_not_ready",
      "웹훅에는 공개 https 주소와 TELEGRAM_WEBHOOK_SECRET이 필요합니다",
    );
  }
  const before = await getReceiverMode(d.appDb);
  await setReceiverMode(d.appDb, mode, session.userId);
  await recordAudit(d.authDb, {
    accountId: null,
    actorUserId: session.userId,
    action: "system.telegram_mode",
    target: { type: "system_setting", id: "telegram_mode" },
    result: "success",
    request,
    diff: computeAuditDiff({ mode: before }, { mode }),
  });
}

// 텔레그램 수신 어댑터 (M8 plan). 폴링·웹훅 두 구현과, 시스템 설정에 따라 둘 중 하나만 켜는 관리자.
// 둘이 동시에 돌면 텔레그램이 409로 거절하므로 전환할 때 한쪽을 먼저 완전히 멈춘다.
import { timingSafeEqual } from "node:crypto";
import type { Db } from "@fmerp/db";
import { processUpdate } from "./link";
import { safeErrorText } from "./safe-error";
import {
  getReceiverMode,
  getUpdateOffset,
  type ReceiverMode,
  setReceiverStatus,
  setUpdateOffset,
} from "./settings";
import { TelegramApiError, type TelegramClient, type TelegramUpdate } from "./telegram-api";

export interface TelegramReceiver {
  readonly mode: ReceiverMode;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface Logger {
  info(message: string): void;
  error(message: string): void;
}

const errorText = safeErrorText;

type UpdateHandler = (update: TelegramUpdate) => Promise<unknown>;

interface PollingOptions {
  client: Pick<TelegramClient, "getUpdates">;
  appDb: Db;
  handle: UpdateHandler;
  logger: Logger;
  /** 롱폴링 대기 초 (기본 25) */
  timeoutSec?: number;
  /** 오류 뒤 다시 시도하기까지 기다리는 ms (기본 5초) */
  retryDelayMs?: number;
}

/** getUpdates 롱폴링. 처리한 마지막 update_id를 DB에 남겨 재시작해도 중복 처리하지 않는다 */
class PollingReceiver implements TelegramReceiver {
  readonly mode = "polling" as const;
  private controller: AbortController | null = null;
  private loop: Promise<void> | null = null;

  constructor(private readonly o: PollingOptions) {}

  async start() {
    if (this.loop) return;
    const controller = new AbortController();
    this.controller = controller;
    this.loop = this.run(controller.signal);
  }

  async stop() {
    this.controller?.abort();
    await this.loop;
    this.loop = null;
    this.controller = null;
  }

  private sleep(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  private async run(signal: AbortSignal) {
    const { client, appDb, handle, logger } = this.o;
    let offset: number | undefined;
    try {
      offset = await getUpdateOffset(appDb);
    } catch (error) {
      logger.error(`[telegram] 오프셋을 읽지 못했습니다: ${errorText(error)}`);
    }
    while (!signal.aborted) {
      try {
        const updates = await client.getUpdates(offset, this.o.timeoutSec ?? 25, signal);
        for (const update of updates) {
          try {
            await handle(update);
          } catch (error) {
            // 한 업데이트가 계속 실패해도 뒤 업데이트를 막지 않도록 건너뛴다
            logger.error(`[telegram] 업데이트 처리 실패: ${errorText(error)}`);
          }
          offset = update.update_id + 1;
        }
        if (updates.length > 0 && offset !== undefined) await setUpdateOffset(appDb, offset);
      } catch (error) {
        if (signal.aborted) break;
        const conflict = error instanceof TelegramApiError && error.status === 409;
        logger.error(
          conflict
            ? "[telegram] 다른 곳에서 같은 봇을 수신 중입니다(409). 웹훅이 켜져 있거나 worker가 둘일 수 있습니다"
            : `[telegram] 폴링 오류: ${errorText(error)}`,
        );
        await this.sleep((this.o.retryDelayMs ?? 5000) * (conflict ? 6 : 1), signal);
      }
    }
  }
}

interface WebhookOptions {
  client: Pick<TelegramClient, "setWebhook">;
  /** 텔레그램이 호출할 공개 HTTPS 주소 (예: https://erp.example.com/api/telegram/webhook) */
  url: string;
  secret: string;
}

/** 웹훅 등록. 요청 수신은 웹 API가 하므로 start에서 주소만 등록한다 */
class WebhookReceiver implements TelegramReceiver {
  readonly mode = "webhook" as const;
  constructor(private readonly o: WebhookOptions) {}
  async start() {
    await this.o.client.setWebhook(this.o.url, this.o.secret);
  }
  async stop() {}
}

/** 웹훅 요청의 비밀 헤더 검증. 길이가 달라도 시간 차이가 새지 않게 상수 시간으로 비교한다 */
export function verifyWebhookSecret(expected: string, actual: string | null | undefined): boolean {
  if (!expected || !actual) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ManagerOptions {
  appDb: Db;
  authDb: Db;
  client: Pick<TelegramClient, "getUpdates" | "setWebhook" | "deleteWebhook" | "sendMessage">;
  /** 공개 HTTPS 주소와 비밀 값이 모두 있어야 웹훅을 켤 수 있다 */
  webhook: { url: string; secret: string } | null;
  logger: Logger;
  now?: () => Date;
  pollingTimeoutSec?: number;
  pollingRetryDelayMs?: number;
}

/** 설정(system_setting)을 읽어 알맞은 수신 어댑터 하나만 켠다. 주기적으로 reconcile을 부른다 */
export class ReceiverManager {
  private current: TelegramReceiver | null = null;
  private busy = false;

  constructor(private readonly o: ManagerOptions) {}

  get mode(): ReceiverMode | null {
    return this.current?.mode ?? null;
  }

  private now() {
    return (this.o.now ?? (() => new Date()))();
  }

  private async report(mode: ReceiverMode | null, error: string | null) {
    await setReceiverStatus(this.o.appDb, { mode, error, at: this.now().toISOString() }).catch(
      () => undefined,
    );
  }

  private create(wanted: ReceiverMode): TelegramReceiver {
    const { appDb, authDb, client, logger, webhook } = this.o;
    if (wanted === "webhook") {
      if (!webhook) {
        throw new Error("웹훅에는 PUBLIC_BASE_URL과 TELEGRAM_WEBHOOK_SECRET이 필요합니다");
      }
      return new WebhookReceiver({ client, ...webhook });
    }
    return new PollingReceiver({
      client,
      appDb,
      logger,
      timeoutSec: this.o.pollingTimeoutSec,
      retryDelayMs: this.o.pollingRetryDelayMs,
      handle: (update) => processUpdate(update, { authDb, client, now: () => this.now() }),
    });
  }

  /** 설정과 실제 상태를 맞춘다. 동시에 두 번 돌지 않는다 */
  async reconcile() {
    if (this.busy) return;
    this.busy = true;
    try {
      const wanted = await getReceiverMode(this.o.appDb);
      if (this.current?.mode === wanted) return;
      const next = this.create(wanted);
      // 이전 방식을 먼저 완전히 멈춘 뒤 새 방식을 켠다 (동시 수신 금지)
      await this.current?.stop();
      this.current = null;
      if (wanted === "polling") await this.o.client.deleteWebhook();
      await next.start();
      this.current = next;
      this.o.logger.info(`[telegram] 수신 방식: ${wanted}`);
      await this.report(wanted, null);
    } catch (error) {
      this.o.logger.error(`[telegram] 수신 방식 전환 실패: ${errorText(error)}`);
      await this.report(this.current?.mode ?? null, errorText(error));
    } finally {
      this.busy = false;
    }
  }

  async stop() {
    await this.current?.stop();
    this.current = null;
  }
}

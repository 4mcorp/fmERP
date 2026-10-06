// 통합 테스트용 가짜 텔레그램 Bot API 서버. 운영 코드에서는 가져오지 않는다.
// 실제 텔레그램처럼 웹훅이 걸려 있으면 getUpdates를 409로 거절하고, 같은 시점의 getUpdates 두 개도 거절한다.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { OpsAlertRules } from "@fmerp/shared/contracts/ops-alerts";
import type { TelegramUpdate } from "../src/service/telegram-api";

/**
 * 운영 알림 규칙의 시험용 대역. 실제 판정(감사·백업 기능)은 각 기능의 단위 시험이 확인하므로,
 * 여기서는 알림이 계약대로 호출하고 결과를 쓰는지만 보는 최소 구현을 쓴다.
 */
export const testOpsRules: OpsAlertRules = {
  reviewStatuses(now, records, months) {
    const kst = new Date(now.getTime() + 9 * 3_600_000);
    const base = kst.getUTCFullYear() * 12 + kst.getUTCMonth();
    return Array.from({ length: months }, (_, i) => {
      const index = base - 1 - i;
      const period = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
      const last = records.filter((r) => r.period === period).at(-1);
      return { period, state: !last ? "pending" : last.abnormal ? "abnormal" : "done" };
    });
  },
  backupHealth: (now) => ({ state: "ok", lastSuccessAt: null, expectedBy: now }),
  isSystemAdmin: (email, verified, allowList) =>
    verified &&
    !!allowList &&
    allowList
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .includes(email.trim().toLowerCase()),
};

export interface SentMessage {
  chatId: number;
  text: string;
}

export class FakeTelegram {
  readonly token = "123456:fake-token";
  sent: SentMessage[] = [];
  webhook: { url: string; secret: string } | null = null;
  /** 다음 sendMessage들에 줄 오류 (앞에서부터 하나씩 소비) */
  sendFailures: { status: number; description: string; retryAfter?: number }[] = [];
  getUpdatesCalls: (number | undefined)[] = [];
  private updates: TelegramUpdate[] = [];
  private waiting: ((u: TelegramUpdate[]) => void) | null = null;
  private server: Server | null = null;
  private nextId = 1000;

  get baseUrl() {
    const port = (this.server?.address() as AddressInfo | null)?.port ?? 0;
    return `http://127.0.0.1:${port}`;
  }

  /** 사용자가 봇에게 메시지를 보낸 것처럼 업데이트를 쌓는다 */
  pushMessage(chatId: number, text: string, type = "private") {
    const update: TelegramUpdate = {
      update_id: this.nextId++,
      message: { text, chat: { id: chatId, type }, from: { id: chatId } },
    };
    this.updates.push(update);
    this.flush();
    return update;
  }

  private flush() {
    if (this.waiting && this.updates.length > 0) {
      const w = this.waiting;
      this.waiting = null;
      w(this.updates);
    }
  }

  async start() {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        this.handle(req.url ?? "", body, res);
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
  }

  async stop() {
    this.waiting?.([]);
    await new Promise<void>((resolve) => {
      this.server?.closeAllConnections();
      this.server?.close(() => resolve());
    });
  }

  private handle(
    url: string,
    body: Record<string, unknown>,
    res: import("node:http").ServerResponse,
  ) {
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    const fail = (status: number, description: string, retryAfter?: number) =>
      json(status, {
        ok: false,
        description,
        ...(retryAfter ? { parameters: { retry_after: retryAfter } } : {}),
      });
    if (!url.startsWith(`/bot${this.token}/`)) return fail(401, "Unauthorized");
    const method = url.slice(`/bot${this.token}/`.length);

    if (method === "sendMessage") {
      const failure = this.sendFailures.shift();
      if (failure) return fail(failure.status, failure.description, failure.retryAfter);
      this.sent.push({ chatId: body.chat_id as number, text: body.text as string });
      return json(200, { ok: true, result: { message_id: this.sent.length } });
    }
    if (method === "getUpdates") {
      if (this.webhook) {
        return fail(409, "Conflict: can't use getUpdates method while webhook is active");
      }
      if (this.waiting) return fail(409, "Conflict: terminated by other getUpdates request");
      const offset = body.offset as number | undefined;
      this.getUpdatesCalls.push(offset);
      if (offset !== undefined) this.updates = this.updates.filter((u) => u.update_id >= offset);
      if (this.updates.length > 0) return json(200, { ok: true, result: this.updates });
      // 롱폴링: 새 업데이트가 오거나 짧은 시간이 지나면 응답한다 (시험이 빨리 끝나도록 timeout을 줄여 쓴다)
      const waitMs = Math.max(1, Number(body.timeout ?? 0)) * 1000;
      const timer = setTimeout(() => {
        this.waiting = null;
        json(200, { ok: true, result: [] });
      }, waitMs);
      this.waiting = (u) => {
        clearTimeout(timer);
        json(200, { ok: true, result: u });
      };
      res.on("close", () => {
        clearTimeout(timer);
        if (this.waiting) this.waiting = null;
      });
      return;
    }
    if (method === "setWebhook") {
      this.webhook = { url: body.url as string, secret: body.secret_token as string };
      return json(200, { ok: true, result: true });
    }
    if (method === "deleteWebhook") {
      this.webhook = null;
      return json(200, { ok: true, result: true });
    }
    if (method === "getWebhookInfo") {
      return json(200, {
        ok: true,
        result: { url: this.webhook?.url ?? "", pending_update_count: 0 },
      });
    }
    return fail(404, "Not Found");
  }
}

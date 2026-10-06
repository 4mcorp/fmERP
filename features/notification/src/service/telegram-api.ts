// 텔레그램 Bot API 클라이언트. fetch만 쓰고 새 패키지는 없다. baseUrl을 바꿔 시험용 가짜 서버에 붙인다.

export interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; type: string };
    from?: { id: number; is_bot?: boolean };
  };
}

export interface WebhookInfo {
  url: string;
  pendingUpdateCount: number;
  lastErrorMessage: string | null;
}

/** Bot API가 ok=false로 답했거나 HTTP 오류인 경우. 토큰이 메시지에 섞이지 않도록 메서드 이름만 남긴다 */
export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    readonly description: string,
    /** 429일 때 기다려야 하는 초 */
    readonly retryAfter: number | null = null,
  ) {
    super(`텔레그램 ${method} 실패 (${status}): ${description}`);
  }
  /** 사용자가 봇을 차단했거나 대화가 사라진 경우: 다시 보내도 소용없다 */
  get isGone() {
    return this.status === 403 || (this.status === 400 && /chat not found/i.test(this.description));
  }
}

export interface TelegramClientOptions {
  token: string;
  /** 기본 https://api.telegram.org */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class TelegramClient {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: TelegramClientOptions) {
    this.base = `${(options.baseUrl ?? "https://api.telegram.org").replace(/\/$/, "")}/bot${options.token}`;
    this.fetchFn = options.fetch ?? fetch;
  }

  private async call<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal) {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      // 네트워크 오류 메시지에는 요청 URL(토큰)이 들어갈 수 있어 이름만 남긴다
      const name = error instanceof Error ? error.name : "Error";
      throw new TelegramApiError(method, 0, `네트워크 오류(${name})`);
    }
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
      description?: string;
      parameters?: { retry_after?: number };
    } | null;
    if (!res.ok || !json?.ok) {
      throw new TelegramApiError(
        method,
        res.status,
        json?.description ?? res.statusText,
        json?.parameters?.retry_after ?? null,
      );
    }
    return json.result as T;
  }

  /** 롱폴링. timeout초 동안 새 업데이트를 기다린다 */
  getUpdates(offset: number | undefined, timeout: number, signal?: AbortSignal) {
    return this.call<TelegramUpdate[]>(
      "getUpdates",
      { offset, timeout, allowed_updates: ["message"] },
      signal,
    );
  }

  sendMessage(chatId: number, text: string) {
    return this.call<{ message_id: number }>("sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    });
  }

  setWebhook(url: string, secretToken: string) {
    return this.call<true>("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message"],
    });
  }

  deleteWebhook() {
    return this.call<true>("deleteWebhook", { drop_pending_updates: false });
  }

  async getWebhookInfo(): Promise<WebhookInfo> {
    const r = await this.call<{
      url: string;
      pending_update_count: number;
      last_error_message?: string;
    }>("getWebhookInfo", {});
    return {
      url: r.url,
      pendingUpdateCount: r.pending_update_count,
      lastErrorMessage: r.last_error_message ?? null,
    };
  }
}

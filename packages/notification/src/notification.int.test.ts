// M8 통합 테스트: 텔레그램 연결, 이벤트 → 알림, 발송, 수신 방식 전환 (실제 DB + 가짜 Bot API 서버)
import { createDatabase, schema } from "@fmerp/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { consumeEvents } from "./consume";
import { createLinkToken, findChatId, MESSAGES, processUpdate } from "./link";
import { ReceiverManager, verifyWebhookSecret } from "./receiver";
import { sendTelegramNotification } from "./send";
import { getReceiverStatus, setReceiverMode } from "./settings";
import { TelegramClient } from "./telegram-api";
import { FakeTelegram } from "./test-support";

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name}이 없습니다`);
  return v;
};
const app = createDatabase(need("DATABASE_URL"));
const auth = createDatabase(need("AUTH_DATABASE_URL"));
const owner = createDatabase(need("MIGRATION_DATABASE_URL"));

const MARK = `m8-${Date.now().toString(36)}`;
const TITLE = `${MARK} 비밀 프로젝트 지출 결의서`;
const fake = new FakeTelegram();
const logs: string[] = [];
const logger = { info: (m: string) => logs.push(m), error: (m: string) => logs.push(m) };

let client: TelegramClient;
let accountId = "";
let businessId = "";
let drafter = { membershipId: "", userId: "" };
let approver = { membershipId: "", userId: "" };
let documentId = "";
const createdDocs: string[] = [];
const createdEvents: string[] = [];

const now = () => new Date();

async function member(email: string) {
  const rows = await owner.pool.query<{ mid: string; uid: string }>(
    `select m.id as mid, u.id as uid from membership m join "user" u on u.id = m.user_id
      where m.account_id = $1 and u.email = $2`,
    [accountId, email],
  );
  return { membershipId: rows.rows[0]?.mid ?? "", userId: rows.rows[0]?.uid ?? "" };
}

async function newDocument(title = TITLE) {
  const r = await owner.pool.query<{ id: string }>(
    `insert into document (account_id, business_id, drafter_membership_id, title, status, policy)
     values ($1, $2, $3, $4, 'DRAFT', '{"disagree":"reject","rejectTo":"drafter","auditCanReject":true}')
     returning id`,
    [accountId, businessId, drafter.membershipId, title],
  );
  const id = r.rows[0]?.id ?? "";
  createdDocs.push(id);
  return id;
}

async function newEvent(docId: string, type: string, payload: Record<string, unknown>) {
  const r = await owner.pool.query<{ id: string }>(
    `insert into approval_event (account_id, document_id, type, payload) values ($1, $2, $3, $4::jsonb) returning id`,
    [accountId, docId, type, JSON.stringify({ type, docId, ...payload })],
  );
  const id = r.rows[0]?.id ?? "";
  createdEvents.push(id);
  return id;
}

async function notificationsOf(docId: string) {
  const r = await owner.pool.query<{
    id: string;
    kind: string;
    recipient_membership_id: string;
    title: string;
    external_text: string;
    telegram_status: string;
  }>(
    "select id, kind, recipient_membership_id, title, external_text, telegram_status from notification where document_id = $1 order by kind",
    [docId],
  );
  return r.rows;
}

async function resetTelegram() {
  await owner.pool.query("delete from telegram_link where user_id = any($1::uuid[])", [
    [drafter.userId, approver.userId],
  ]);
  await owner.pool.query("delete from telegram_link where chat_id between 555 and 999");
  await owner.pool.query("delete from telegram_link_token where user_id = any($1::uuid[])", [
    [drafter.userId, approver.userId],
  ]);
  await owner.pool.query(
    "delete from system_setting where key in ('telegram_mode','telegram_update_offset','telegram_receiver_status')",
  );
}

beforeAll(async () => {
  await fake.start();
  client = new TelegramClient({ token: fake.token, baseUrl: fake.baseUrl });
  const a = await owner.pool.query<{ id: string }>(
    "select id from account where slug = 'fourm-test'",
  );
  accountId = a.rows[0]?.id ?? "";
  const b = await owner.pool.query<{ id: string }>(
    "select id from business where account_id = $1 and code = 'FM'",
    [accountId],
  );
  businessId = b.rows[0]?.id ?? "";
  drafter = await member("member1@example.com");
  approver = await member("member2@example.com");
  if (!accountId || !businessId || !drafter.userId || !approver.userId) {
    throw new Error("시드 계정이 없습니다");
  }
  // 다른 시험 파일이 남긴 처리 대기 이벤트가 한 번에 처리하는 개수(100)를 채우지 않게 모두 처리된 것으로 표시한다
  await owner.pool.query(
    "insert into event_notified (event_id, account_id) select id, account_id from approval_event e where not exists (select 1 from event_notified n where n.event_id = e.id) on conflict do nothing",
  );
  await resetTelegram();
  documentId = await newDocument();
});

afterAll(async () => {
  await resetTelegram();
  if (createdDocs.length > 0) {
    await owner.pool.query("delete from notification where document_id = any($1::uuid[])", [
      createdDocs,
    ]);
    await owner.pool.query("delete from event_notified where event_id = any($1::uuid[])", [
      createdEvents,
    ]);
    await owner.pool.query("delete from approval_event where id = any($1::uuid[])", [
      createdEvents,
    ]);
    await owner.pool.query("delete from document where id = any($1::uuid[])", [createdDocs]);
  }
  await fake.stop();
  await Promise.all([app.pool.end(), auth.pool.end(), owner.pool.end()]);
});

beforeEach(() => {
  fake.sent = [];
  fake.sendFailures = [];
});

describe("텔레그램 연결 (토큰 + /start)", () => {
  const deps = () => ({ authDb: auth.db, client, now });
  const start = (chatId: number, text: string, type = "private") =>
    processUpdate(fake.pushMessage(chatId, text, type), deps());

  it("유효한 토큰으로 /start 하면 연결되고 확인 메시지를 받는다", async () => {
    await resetTelegram();
    fake.sent = [];
    const { token } = await createLinkToken(auth.db, drafter.userId, now());
    expect(await start(555, `/start ${token}`)).toBe("linked");
    expect(await findChatId(auth.db, drafter.userId)).toBe(555);
    expect(fake.sent).toEqual([{ chatId: 555, text: MESSAGES.linked }]);
  });

  it("토큰 원문은 DB에 없고 해시만 있다", async () => {
    const { token } = await createLinkToken(auth.db, drafter.userId, now());
    const rows = await owner.pool.query<{ token_hash: string }>(
      "select token_hash from telegram_link_token where user_id = $1",
      [drafter.userId],
    );
    expect(rows.rows.some((r) => r.token_hash.includes(token))).toBe(false);
    expect(rows.rows.every((r) => r.token_hash.length === 64)).toBe(true);
  });

  it("같은 토큰은 한 번만, 새 토큰을 발급하면 이전 토큰은 무효", async () => {
    const first = await createLinkToken(auth.db, approver.userId, now());
    const second = await createLinkToken(auth.db, approver.userId, now());
    expect(await start(556, `/start ${first.token}`)).toBe("invalid");
    expect(await start(556, `/start ${second.token}`)).toBe("linked");
    expect(await start(557, `/start ${second.token}`)).toBe("invalid");
    expect(await findChatId(auth.db, approver.userId)).toBe(556);
  });

  it("만료된 토큰은 거부한다", async () => {
    const { token } = await createLinkToken(auth.db, approver.userId, now());
    const later = new Date(Date.now() + 11 * 60 * 1000);
    const outcome = await processUpdate(fake.pushMessage(558, `/start ${token}`), {
      authDb: auth.db,
      client,
      now: () => later,
    });
    expect(outcome).toBe("invalid");
    expect(fake.sent.at(-1)?.text).toBe(MESSAGES.invalid);
  });

  it("개인 대화가 아니거나 /start가 아닌 메시지는 무시하고, 토큰 없는 /start는 안내한다", async () => {
    const { token } = await createLinkToken(auth.db, approver.userId, now());
    expect(await start(559, `/start ${token}`, "group")).toBe("ignored");
    expect(await start(559, "안녕하세요")).toBe("ignored");
    expect(await start(559, "/start")).toBe("guide");
    expect(await start(559, "/start 짧음")).toBe("ignored");
    expect(await findChatId(auth.db, approver.userId)).toBe(556);
  });

  it("다른 사용자가 같은 대화를 연결하면 이전 연결은 끊어진다", async () => {
    const { token } = await createLinkToken(auth.db, drafter.userId, now());
    expect(await start(556, `/start ${token}`)).toBe("linked");
    expect(await findChatId(auth.db, drafter.userId)).toBe(556);
    expect(await findChatId(auth.db, approver.userId)).toBeNull();
  });
});

describe("결재 이벤트 → 알림", () => {
  it("결재 차례 이벤트가 결재자 알림이 되고, 다시 처리해도 중복되지 않는다", async () => {
    const eventId = await newEvent(documentId, "step_activated", {
      stepId: crypto.randomUUID(),
      assigneeIds: [approver.membershipId],
      delegateIds: [],
    });
    const created: string[] = [];
    const errors: unknown[] = [];
    const run = () =>
      consumeEvents(app.db, {
        telegram: true,
        onCreated: async (c) => {
          created.push(...c.map((n) => n.id));
        },
        onError: (_e, error) => errors.push(error),
      });
    await run();
    expect(errors).toEqual([]);
    const list = await notificationsOf(documentId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      kind: "approval_requested",
      recipient_membership_id: approver.membershipId,
      telegram_status: "PENDING",
    });
    expect(list[0]?.title).toContain("비밀 프로젝트");
    expect(list[0]?.external_text).not.toContain("비밀 프로젝트");
    const done = await owner.pool.query("select 1 from event_notified where event_id = $1", [
      eventId,
    ]);
    expect(done.rowCount).toBe(1);

    // 처리 표시를 지우고 다시 돌려도 알림은 한 개 (유니크)
    await owner.pool.query("delete from event_notified where event_id = $1", [eventId]);
    await run();
    expect(await notificationsOf(documentId)).toHaveLength(1);
    expect(created).toHaveLength(1);
  });

  it("완료는 기안자에게, 회수는 payload의 결재 차례였던 사람에게", async () => {
    const doc = await newDocument();
    await newEvent(doc, "completed", {});
    await newEvent(doc, "withdrawn", { activeAssigneeIds: [approver.membershipId] });
    await consumeEvents(app.db, {
      telegram: true,
      onCreated: async () => undefined,
      onError: () => undefined,
    });
    const list = await notificationsOf(doc);
    expect(list.map((n) => `${n.kind}:${n.recipient_membership_id}`).sort()).toEqual(
      [
        `approval_completed:${drafter.membershipId}`,
        `approval_withdrawn:${approver.membershipId}`,
      ].sort(),
    );
  });

  it("퇴사한 구성원에게는 알림을 만들지 않는다", async () => {
    const doc = await newDocument();
    await owner.pool.query("update membership set status = 'left' where id = $1", [
      approver.membershipId,
    ]);
    try {
      await newEvent(doc, "step_activated", {
        stepId: crypto.randomUUID(),
        assigneeIds: [approver.membershipId],
        delegateIds: [],
      });
      await consumeEvents(app.db, {
        telegram: true,
        onCreated: async () => undefined,
        onError: () => undefined,
      });
      expect(await notificationsOf(doc)).toEqual([]);
    } finally {
      await owner.pool.query("update membership set status = 'active' where id = $1", [
        approver.membershipId,
      ]);
    }
  });

  it("문서가 없는 이벤트도 처리 표시만 남기고 끝난다", async () => {
    const ghost = crypto.randomUUID();
    const eventId = await newEvent(ghost, "completed", {});
    await consumeEvents(app.db, {
      telegram: true,
      onCreated: async () => undefined,
      onError: () => undefined,
    });
    const done = await owner.pool.query("select 1 from event_notified where event_id = $1", [
      eventId,
    ]);
    expect(done.rowCount).toBe(1);
  });
});

describe("텔레그램 발송", () => {
  async function pendingFor(membershipId: string, text = "결재 요청 1건 · 기안자 김기안") {
    const doc = await newDocument();
    const r = await owner.pool.query<{ id: string }>(
      `insert into notification (account_id, recipient_membership_id, kind, document_id, title, external_text, dedupe_key, telegram_status)
       values ($1, $2, 'approval_requested', $3, $4, $5, $6, 'PENDING') returning id`,
      [accountId, membershipId, doc, TITLE, text, `${MARK}:${crypto.randomUUID()}`],
    );
    return { id: r.rows[0]?.id ?? "", doc };
  }
  const statusOf = async (id: string) =>
    (
      await owner.pool.query<{ telegram_status: string }>(
        "select telegram_status from notification where id = $1",
        [id],
      )
    ).rows[0]?.telegram_status;
  const deps = () => ({ appDb: app.db, authDb: auth.db, client, baseUrl: "https://erp.test/" });

  beforeEach(async () => {
    await owner.pool.query("delete from telegram_link where user_id = any($1::uuid[])", [
      [drafter.userId, approver.userId],
    ]);
    await owner.pool.query("delete from telegram_link where chat_id between 555 and 999");
    await auth.pool.query("insert into telegram_link (user_id, chat_id) values ($1, 777)", [
      approver.userId,
    ]);
  });

  it("연결된 사용자에게 외부 문구와 링크만 보내고, 한 번만 보낸다", async () => {
    const n = await pendingFor(approver.membershipId);
    const job = { accountId, notificationId: n.id };
    expect(await sendTelegramNotification(deps(), job, false)).toBe("sent");
    expect(fake.sent).toEqual([
      { chatId: 777, text: `결재 요청 1건 · 기안자 김기안\nhttps://erp.test/approval/${n.doc}` },
    ]);
    expect(fake.sent[0]?.text).not.toContain("비밀 프로젝트");
    expect(await statusOf(n.id)).toBe("SENT");
    expect(await sendTelegramNotification(deps(), job, false)).toBe("not_pending");
    expect(fake.sent).toHaveLength(1);
  });

  it("연결되지 않은 사용자는 건너뛴다", async () => {
    const n = await pendingFor(drafter.membershipId);
    expect(await sendTelegramNotification(deps(), { accountId, notificationId: n.id }, false)).toBe(
      "skipped",
    );
    expect(fake.sent).toEqual([]);
    expect(await statusOf(n.id)).toBe("SKIPPED");
  });

  it("사용자가 봇을 차단하면(403) 연결을 풀고 건너뛴다", async () => {
    const n = await pendingFor(approver.membershipId);
    fake.sendFailures = [{ status: 403, description: "Forbidden: bot was blocked by the user" }];
    expect(await sendTelegramNotification(deps(), { accountId, notificationId: n.id }, false)).toBe(
      "skipped",
    );
    expect(await findChatId(auth.db, approver.userId)).toBeNull();
    expect(await statusOf(n.id)).toBe("SKIPPED");
  });

  it("일시 오류는 던지고 대기 상태를 유지하다가, 마지막 시도에서만 FAILED가 된다", async () => {
    const n = await pendingFor(approver.membershipId);
    const job = { accountId, notificationId: n.id };
    fake.sendFailures = [
      { status: 429, description: "Too Many Requests", retryAfter: 3 },
      { status: 500, description: "Internal Server Error" },
    ];
    await expect(sendTelegramNotification(deps(), job, false)).rejects.toMatchObject({
      status: 429,
      retryAfter: 3,
    });
    expect(await statusOf(n.id)).toBe("PENDING");
    await expect(sendTelegramNotification(deps(), job, true)).rejects.toMatchObject({
      status: 500,
    });
    expect(await statusOf(n.id)).toBe("FAILED");
    expect(await findChatId(auth.db, approver.userId)).toBe(777);
  });

  it("오류 메시지에 봇 토큰이 들어가지 않는다", async () => {
    const bad = new TelegramClient({ token: fake.token, baseUrl: "http://127.0.0.1:1" });
    const error = await bad.sendMessage(1, "x").catch((e: Error) => e);
    expect(String(error)).not.toContain(fake.token);
  });
});

describe("수신 방식 전환 (폴링 ↔ 웹훅)", () => {
  const webhook = { url: "https://erp.test/api/telegram/webhook", secret: "s3cret-value" };
  const manager = (withWebhook: boolean) =>
    new ReceiverManager({
      appDb: app.db,
      authDb: auth.db,
      client,
      webhook: withWebhook ? webhook : null,
      logger,
      pollingTimeoutSec: 1,
      pollingRetryDelayMs: 50,
    });
  const waitFor = async (check: () => Promise<boolean> | boolean, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return false;
  };

  beforeEach(async () => {
    await resetTelegram();
    fake.webhook = null;
    fake.getUpdatesCalls = [];
  });

  it("기본은 폴링: /start를 받아 연결하고, 처리한 위치(offset)를 저장한다", async () => {
    const m = manager(true);
    await m.reconcile();
    expect(m.mode).toBe("polling");
    const { token } = await createLinkToken(auth.db, approver.userId, now());
    const update = fake.pushMessage(560, `/start ${token}`);
    expect(await waitFor(async () => (await findChatId(auth.db, approver.userId)) === 560)).toBe(
      true,
    );
    const saved = await owner.pool.query<{ value: number }>(
      "select value from system_setting where key = 'telegram_update_offset'",
    );
    expect(
      await waitFor(async () => {
        const r = await owner.pool.query<{ value: number }>(
          "select value from system_setting where key = 'telegram_update_offset'",
        );
        return r.rows[0]?.value === update.update_id + 1;
      }),
    ).toBe(true);
    expect(saved).toBeDefined();
    await m.stop();
  });

  it("설정을 웹훅으로 바꾸면 폴링을 멈추고 웹훅을 등록하며, 되돌리면 웹훅을 지우고 폴링한다", async () => {
    const m = manager(true);
    await m.reconcile();
    expect(m.mode).toBe("polling");

    await setReceiverMode(app.db, "webhook", drafter.userId);
    await m.reconcile();
    expect(m.mode).toBe("webhook");
    expect(fake.webhook).toEqual({ url: webhook.url, secret: webhook.secret });
    expect((await getReceiverStatus(app.db))?.mode).toBe("webhook");

    // 웹훅이 켜진 동안에는 폴링하지 않는다 (켜져 있었다면 가짜 서버가 409를 줘서 로그에 남는다)
    logs.length = 0;
    await new Promise((r) => setTimeout(r, 1300));
    expect(logs.filter((l) => l.includes("409"))).toEqual([]);

    await setReceiverMode(app.db, "polling", drafter.userId);
    await m.reconcile();
    expect(m.mode).toBe("polling");
    expect(fake.webhook).toBeNull();

    const { token } = await createLinkToken(auth.db, approver.userId, now());
    fake.pushMessage(561, `/start ${token}`);
    expect(await waitFor(async () => (await findChatId(auth.db, approver.userId)) === 561)).toBe(
      true,
    );
    await m.stop();
  });

  it("공개 주소·비밀 값이 없으면 웹훅으로 전환하지 못하고 폴링을 그대로 둔다", async () => {
    const m = manager(false);
    await m.reconcile();
    await setReceiverMode(app.db, "webhook", drafter.userId);
    await m.reconcile();
    expect(m.mode).toBe("polling");
    const status = await getReceiverStatus(app.db);
    expect(status?.mode).toBe("polling");
    expect(status?.error).toContain("PUBLIC_BASE_URL");
    expect(fake.webhook).toBeNull();
    await m.stop();
  });

  it("웹훅 비밀 헤더는 정확히 같을 때만 통과한다", () => {
    expect(verifyWebhookSecret("abc123", "abc123")).toBe(true);
    expect(verifyWebhookSecret("abc123", "abc124")).toBe(false);
    expect(verifyWebhookSecret("abc123", "abc12")).toBe(false);
    expect(verifyWebhookSecret("abc123", undefined)).toBe(false);
    expect(verifyWebhookSecret("", "")).toBe(false);
  });
});

describe("알림 종류 목록", () => {
  it("db의 종류 목록이 core와 같다", async () => {
    const core = await import("@fmerp/core");
    expect([...schema.NOTIFICATION_KINDS]).toEqual([...core.NOTIFICATION_KINDS]);
  });
});

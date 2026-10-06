// M8 통합 테스트: 알림 API(본인 것만·테넌트 격리·읽음), 텔레그램 연결 API, 웹훅 수신, 수신 방식 설정 (실제 DB + 가짜 Bot API)
import { createDatabase } from "@fmerp/db";
import {
  clientWithCookie,
  json,
  loginAs,
  type TestClient,
} from "@fmerp/shared/testing/test-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeTelegram } from "./test-support";

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name}이 없습니다`);
  return v;
};
const owner = createDatabase(need("MIGRATION_DATABASE_URL"));

const fake = new FakeTelegram();
const SECRET = "webhook-secret-for-tests-1234";
const MARK = `m8-api-${Date.now().toString(36)}`;
const clients: Record<string, TestClient> = {};
const ids: Record<string, { membershipId: string; userId: string }> = {};
let accountId = "";
let otherAccountId = "";
const notificationIds: string[] = [];

const req = (who: string, path: string, method = "GET", body?: unknown, headers = {}) =>
  (clients[who] as TestClient).request(path, {
    method,
    body: body === undefined && method !== "GET" ? {} : body,
    headers: { "x-forwarded-for": "198.51.100.10", ...headers },
  });

async function addNotification(membershipId: string, acct: string, key: string, read = false) {
  const r = await owner.pool.query<{ id: string }>(
    `insert into notification (account_id, recipient_membership_id, kind, title, body, dedupe_key, read_at)
     values ($1, $2, 'approval_requested', $3, '본문', $4, $5) returning id`,
    [acct, membershipId, `${MARK} 알림 ${key}`, `${MARK}:${key}`, read ? new Date() : null],
  );
  const id = r.rows[0]?.id ?? "";
  notificationIds.push(id);
  return id;
}

async function resetPins(emails: string[]) {
  await owner.pool.query(
    'delete from approval_pin where user_id in (select id from "user" where email = any($1::text[]))',
    [emails],
  );
}

async function verifyPin(who: string) {
  await req(who, "/api/me/pin", "PUT", { pin: "246810" });
  for (const pin of ["246810", "135790", "482915"]) {
    if ((await req(who, "/api/me/pin/verify", "POST", { pin })).status === 200) return;
  }
  throw new Error("PIN을 확인하지 못했습니다");
}

const webhook = (body: unknown, secret?: string) =>
  clientWithCookie("").request("/api/telegram/webhook", {
    method: "POST",
    body,
    headers: secret === undefined ? {} : { "x-telegram-bot-api-secret-token": secret },
  });

beforeAll(async () => {
  await fake.start();
  // 환경 변수는 첫 요청에서 읽는다 (getEnv). 이 파일이 첫 요청 전에 설정한다
  process.env.TELEGRAM_BOT_TOKEN = fake.token;
  process.env.TELEGRAM_BOT_USERNAME = "fourm_test_bot";
  process.env.TELEGRAM_API_BASE_URL = fake.baseUrl;
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;

  for (const [key, email] of [
    ["owner", "owner@example.com"],
    ["member1", "member1@example.com"],
    ["member2", "member2@example.com"],
    ["otherOwner", "owner-b@example.com"],
  ] as const) {
    clients[key] = await loginAs(email);
  }

  // 다른 시험이 사용자를 다른 회사에 합류시켰을 수 있어, 회사를 slug로 못 박고 활성 회사도 맞춘다
  const rows = await owner.pool.query<{
    email: string;
    mid: string;
    uid: string;
    aid: string;
    slug: string;
  }>(
    `select u.email, m.id as mid, u.id as uid, m.account_id as aid, a.slug from membership m
       join "user" u on u.id = m.user_id join account a on a.id = m.account_id
      where u.email = any($1::text[]) and a.slug in ('fourm-test', 'other-company')`,
    [["owner@example.com", "member1@example.com", "member2@example.com", "owner-b@example.com"]],
  );
  const by = (email: string, slug: string) =>
    rows.rows.find((r) => r.email === email && r.slug === slug);
  accountId = by("member1@example.com", "fourm-test")?.aid ?? "";
  otherAccountId = by("owner-b@example.com", "other-company")?.aid ?? "";
  for (const [key, email, slug] of [
    ["owner", "owner@example.com", "fourm-test"],
    ["member1", "member1@example.com", "fourm-test"],
    ["member2", "member2@example.com", "fourm-test"],
    ["otherOwner", "owner-b@example.com", "other-company"],
  ] as const) {
    const row = by(email, slug);
    ids[key] = { membershipId: row?.mid ?? "", userId: row?.uid ?? "" };
    await req(key, "/api/accounts/active", "POST", { accountId: row?.aid });
  }
  await resetPins(["owner@example.com"]);
  await owner.pool.query("delete from system_setting where key like 'telegram_%'");
  await owner.pool.query("delete from telegram_link where user_id = any($1::uuid[])", [
    Object.values(ids).map((i) => i.userId),
  ]);
});

afterAll(async () => {
  await owner.pool.query("delete from notification where id = any($1::uuid[])", [notificationIds]);
  await owner.pool.query("delete from system_setting where key like 'telegram_%'");
  await owner.pool.query("delete from telegram_link where user_id = any($1::uuid[])", [
    Object.values(ids).map((i) => i.userId),
  ]);
  await owner.pool.query("delete from telegram_link_token where user_id = any($1::uuid[])", [
    Object.values(ids).map((i) => i.userId),
  ]);
  await resetPins(["owner@example.com"]);
  await fake.stop();
  await owner.pool.end();
});

describe("인앱 알림 API", () => {
  it("로그인 없이는 접근할 수 없다", async () => {
    const res = await clientWithCookie("").request("/api/notifications");
    expect(res.status).toBe(401);
  });

  it("본인 알림만 목록·개수에 나오고, 읽음 처리하면 개수가 줄어든다", async () => {
    const mine1 = await addNotification(ids.member1?.membershipId ?? "", accountId, "m1-a");
    await addNotification(ids.member1?.membershipId ?? "", accountId, "m1-b");
    await addNotification(ids.member2?.membershipId ?? "", accountId, "m2-a");

    const list = await json<{ items: { id: string; title: string; readAt: string | null }[] }>(
      await req("member1", "/api/notifications"),
    );
    const titles = list.items.map((i) => i.title).filter((t) => t.startsWith(MARK));
    expect(titles.sort()).toEqual([`${MARK} 알림 m1-a`, `${MARK} 알림 m1-b`]);

    const before = await json<{ count: number }>(
      await req("member1", "/api/notifications/unread-count"),
    );
    expect((await req("member1", `/api/notifications/${mine1}/read`, "POST")).status).toBe(200);
    const after = await json<{ count: number }>(
      await req("member1", "/api/notifications/unread-count"),
    );
    expect(after.count).toBe(before.count - 1);

    const unreadOnly = await json<{ items: { id: string }[] }>(
      await req("member1", "/api/notifications?unread=true"),
    );
    expect(unreadOnly.items.some((i) => i.id === mine1)).toBe(false);
  });

  it("남의 알림·다른 회사의 알림은 읽음 처리할 수 없다 (404)", async () => {
    const others = await addNotification(ids.member2?.membershipId ?? "", accountId, "m2-b");
    expect((await req("member1", `/api/notifications/${others}/read`, "POST")).status).toBe(404);
    // 다른 회사 사용자도 같은 id로 접근하지 못한다
    expect((await req("otherOwner", `/api/notifications/${others}/read`, "POST")).status).toBe(404);
    const listed = await json<{ items: { id: string }[] }>(
      await req("otherOwner", "/api/notifications"),
    );
    expect(listed.items.some((i) => i.id === others)).toBe(false);
    // 아직 읽지 않은 상태 그대로
    const row = await owner.pool.query("select read_at from notification where id = $1", [others]);
    expect(row.rows[0]?.read_at).toBeNull();
  });

  it("모두 읽음은 내 알림만 바꾼다", async () => {
    const mine = await addNotification(ids.member1?.membershipId ?? "", accountId, "m1-c");
    const theirs = await addNotification(ids.member2?.membershipId ?? "", accountId, "m2-c");
    expect((await req("member1", "/api/notifications/read-all", "POST")).status).toBe(200);
    const rows = await owner.pool.query<{ id: string; read_at: Date | null }>(
      "select id, read_at from notification where id = any($1::uuid[])",
      [[mine, theirs]],
    );
    expect(rows.rows.find((r) => r.id === mine)?.read_at).not.toBeNull();
    expect(rows.rows.find((r) => r.id === theirs)?.read_at).toBeNull();
  });

  it("다른 회사 알림은 그 회사의 사용자만 본다 (테넌트 격리)", async () => {
    await addNotification(ids.otherOwner?.membershipId ?? "", otherAccountId, "b-a");
    const mine = await json<{ items: { title: string }[] }>(
      await req("member1", "/api/notifications?limit=100"),
    );
    expect(mine.items.some((i) => i.title.includes("b-a"))).toBe(false);
    const theirs = await json<{ items: { title: string }[] }>(
      await req("otherOwner", "/api/notifications?limit=100"),
    );
    expect(theirs.items.some((i) => i.title.includes("b-a"))).toBe(true);
  });
});

describe("텔레그램 연결 API", () => {
  it("연결 링크를 만들고, 봇에서 /start 하면 웹훅으로 연결된다", async () => {
    const status = await json<{ enabled: boolean; linked: boolean }>(
      await req("member1", "/api/me/telegram"),
    );
    expect(status).toEqual({ enabled: true, linked: false });

    const link = await json<{ url: string; expiresAt: string }>(
      await req("member1", "/api/me/telegram/link", "POST"),
    );
    expect(link.url).toMatch(/^https:\/\/t\.me\/fourm_test_bot\?start=[A-Za-z0-9_-]{20,}$/);
    const token = link.url.split("start=")[1] ?? "";

    // 잘못된 비밀 값/없는 비밀 값은 존재를 알리지 않는다
    const update = {
      update_id: 1,
      message: { text: `/start ${token}`, chat: { id: 801, type: "private" } },
    };
    expect((await webhook(update, "wrong-secret-value-xyz")).status).toBe(404);
    expect((await webhook(update)).status).toBe(404);
    expect((await json<{ linked: boolean }>(await req("member1", "/api/me/telegram"))).linked).toBe(
      false,
    );

    fake.sent = [];
    expect((await webhook(update, SECRET)).status).toBe(200);
    expect((await json<{ linked: boolean }>(await req("member1", "/api/me/telegram"))).linked).toBe(
      true,
    );
    expect(fake.sent.at(-1)?.chatId).toBe(801);

    // 같은 토큰을 다시 보내면 거부 메시지, 연결은 그대로
    fake.sent = [];
    expect((await webhook(update, SECRET)).status).toBe(200);
    expect(fake.sent.at(-1)?.text).toContain("만료");
  });

  it("다른 사용자의 연결 상태는 영향을 받지 않고, 해제하면 연결이 사라진다", async () => {
    expect((await json<{ linked: boolean }>(await req("member2", "/api/me/telegram"))).linked).toBe(
      false,
    );
    expect((await req("member1", "/api/me/telegram/unlink", "POST")).status).toBe(200);
    expect((await json<{ linked: boolean }>(await req("member1", "/api/me/telegram"))).linked).toBe(
      false,
    );
  });

  it("웹훅 본문 형식이 잘못되면 400", async () => {
    expect((await webhook({ nope: true }, SECRET)).status).toBe(400);
  });
});

describe("수신 방식 설정 (시스템 관리자)", () => {
  it("시스템 관리자가 아니면 존재를 알리지 않는다 (404)", async () => {
    expect((await req("member1", "/api/system/telegram")).status).toBe(404);
    expect(
      (await req("member1", "/api/system/telegram/mode", "POST", { mode: "polling" })).status,
    ).toBe(404);
  });

  it("상태를 읽고, PIN 재인증 뒤에 방식을 바꾸며, 웹훅 조건이 안 되면 409", async () => {
    const state = await json<{
      mode: string;
      configured: { botToken: boolean; webhookReady: boolean };
    }>(await req("owner", "/api/system/telegram"));
    expect(state.mode).toBe("polling");
    expect(state.configured.botToken).toBe(true);
    // 시험 환경의 공개 주소는 http라 웹훅을 켤 수 없다
    expect(state.configured.webhookReady).toBe(false);

    // PIN 없이는 428
    const noPin = await req("owner", "/api/system/telegram/mode", "POST", { mode: "polling" });
    expect(noPin.status).toBe(428);

    await verifyPin("owner");
    const blocked = await req("owner", "/api/system/telegram/mode", "POST", { mode: "webhook" });
    expect(blocked.status).toBe(409);
    expect((await json<{ code: string }>(blocked)).code).toBe("webhook_not_ready");

    expect(
      (await req("owner", "/api/system/telegram/mode", "POST", { mode: "polling" })).status,
    ).toBe(200);
    const saved = await owner.pool.query(
      "select value from system_setting where key = 'telegram_mode'",
    );
    expect(saved.rows[0]?.value).toBe("polling");

    const audit = await owner.pool.query(
      "select 1 from audit_log where action = 'system.telegram_mode' and actor_user_id = $1",
      [ids.owner?.userId],
    );
    expect(audit.rowCount).toBeGreaterThan(0);
  });
});

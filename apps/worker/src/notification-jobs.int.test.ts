// worker 알림 통합 테스트 (실제 DB·pg-boss + 가짜 텔레그램): 결재 이벤트가 큐를 거쳐 DM이 되고, 토큰이 없으면 인앱만 만든다 (M8)
import { createDatabase } from "@fmerp/db";
import { createLinkToken, processUpdate, TelegramClient } from "@fmerp/notification";
import { FakeTelegram } from "@fmerp/notification/test-support";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type NotificationJobs, registerNotificationJobs } from "./notification-jobs";

const appDb = createDatabase(process.env.DATABASE_URL ?? "");
const authDb = createDatabase(process.env.AUTH_DATABASE_URL ?? "");
const owner = createDatabase(process.env.MIGRATION_DATABASE_URL ?? "");
const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL ?? "",
  schema: "pgboss_test_notify",
});
const fake = new FakeTelegram();
const logs: string[] = [];
const logger = { info: (m: string) => logs.push(m), error: (m: string) => logs.push(m) };

const MARK = `m8w-${Date.now().toString(36)}`;
let accountId = "";
let drafter = "";
let approver = { membershipId: "", userId: "" };
let documentId = "";
let jobs: NotificationJobs | null = null;

async function waitFor(check: () => Promise<boolean> | boolean, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function clearJobs(b: PgBoss) {
  for (let attempt = 1; ; attempt++) {
    try {
      await b.deleteAllJobs();
      return;
    } catch (error) {
      if (attempt >= 5 || !String(error).includes("deadlock")) throw error;
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
}

const baseDeps = () => ({
  appDb: appDb.db,
  authDb: authDb.db,
  baseUrl: "https://erp.test",
  webhook: null,
  logger,
});

async function addEvent(type: string, payload: Record<string, unknown>) {
  await owner.pool.query(
    "insert into approval_event (account_id, document_id, type, payload) values ($1, $2, $3, $4::jsonb)",
    [accountId, documentId, type, JSON.stringify({ type, docId: documentId, ...payload })],
  );
}

beforeAll(async () => {
  boss.on("error", () => {});
  await boss.start();
  await clearJobs(boss);
  await fake.start();

  const a = await owner.pool.query<{ id: string }>(
    "select id from account where slug = 'fourm-test'",
  );
  accountId = a.rows[0]?.id ?? "";
  const m = await owner.pool.query<{ mid: string; uid: string; email: string }>(
    `select m.id as mid, u.id as uid, u.email from membership m join "user" u on u.id = m.user_id
      where m.account_id = $1 and u.email in ('member1@example.com','member2@example.com')`,
    [accountId],
  );
  drafter = m.rows.find((r) => r.email === "member1@example.com")?.mid ?? "";
  const ap = m.rows.find((r) => r.email === "member2@example.com");
  approver = { membershipId: ap?.mid ?? "", userId: ap?.uid ?? "" };
  const b = await owner.pool.query<{ id: string }>(
    "select id from business where account_id = $1 and code = 'FM'",
    [accountId],
  );
  const d = await owner.pool.query<{ id: string }>(
    `insert into document (account_id, business_id, drafter_membership_id, title, status, policy)
     values ($1, $2, $3, $4, 'DRAFT', '{"disagree":"reject","rejectTo":"drafter","auditCanReject":true}') returning id`,
    [accountId, b.rows[0]?.id, drafter, `${MARK} 문서`],
  );
  documentId = d.rows[0]?.id ?? "";
  // 이전 실행이 남긴 처리 대기 이벤트가 이번 시험에 끼어들지 않게 모두 처리된 것으로 표시한다
  await owner.pool.query(
    "insert into event_notified (event_id, account_id) select id, account_id from approval_event e where not exists (select 1 from event_notified n where n.event_id = e.id) on conflict do nothing",
  );
  await owner.pool.query("delete from telegram_link where user_id = $1", [approver.userId]);
  await owner.pool.query("delete from system_setting where key like 'telegram_%'");
}, 60_000);

afterAll(async () => {
  await jobs?.stop();
  await owner.pool.query("delete from notification where document_id = $1", [documentId]);
  await owner.pool.query(
    "delete from event_notified where event_id in (select id from approval_event where document_id = $1)",
    [documentId],
  );
  await owner.pool.query("delete from approval_event where document_id = $1", [documentId]);
  await owner.pool.query("delete from document where id = $1", [documentId]);
  await owner.pool.query("delete from telegram_link where user_id = $1", [approver.userId]);
  await owner.pool.query("delete from system_setting where key like 'telegram_%'");
  await fake.stop();
  await boss.stop({ graceful: false });
  await Promise.all([appDb.pool.end(), authDb.pool.end(), owner.pool.end()]);
});

const statusOf = async () =>
  (
    await owner.pool.query<{ telegram_status: string }>(
      "select telegram_status from notification where document_id = $1 and recipient_membership_id = $2",
      [documentId, approver.membershipId],
    )
  ).rows[0]?.telegram_status;

describe("worker 알림 작업", () => {
  it("봇 토큰이 없으면 인앱 알림만 만들고 텔레그램 대상으로 표시하지 않는다", async () => {
    jobs = await registerNotificationJobs(boss, { ...baseDeps(), client: null });
    await addEvent("step_activated", {
      stepId: crypto.randomUUID(),
      assigneeIds: [approver.membershipId],
      delegateIds: [],
    });
    expect(await waitFor(async () => (await statusOf()) !== undefined)).toBe(true);
    expect(await statusOf()).toBe("NONE");
    expect(logs.some((l) => l.includes("TELEGRAM_BOT_TOKEN"))).toBe(true);
    await jobs.stop();
    jobs = null;
    await owner.pool.query("delete from notification where document_id = $1", [documentId]);
  });

  it("연결된 사용자의 결재 차례 이벤트가 큐를 거쳐 텔레그램 DM이 된다", async () => {
    const client = new TelegramClient({ token: fake.token, baseUrl: fake.baseUrl });
    // 먼저 연결한다 (실제로는 폴링이 받지만, 여기서는 같은 처리 함수를 직접 부른다)
    const { token } = await createLinkToken(authDb.db, approver.userId, new Date());
    await processUpdate(
      { update_id: 1, message: { text: `/start ${token}`, chat: { id: 700, type: "private" } } },
      {
        authDb: authDb.db,
        client,
        now: () => new Date(),
      },
    );
    fake.sent = [];

    jobs = await registerNotificationJobs(boss, { ...baseDeps(), client });
    await addEvent("step_activated", {
      stepId: crypto.randomUUID(),
      assigneeIds: [approver.membershipId],
      delegateIds: [],
    });
    expect(await waitFor(() => fake.sent.some((s) => s.chatId === 700))).toBe(true);
    const sent = fake.sent.find((s) => s.chatId === 700);
    expect(sent?.text).toContain(`https://erp.test/approval/${documentId}`);
    expect(sent?.text).not.toContain(MARK);
    expect(await waitFor(async () => (await statusOf()) === "SENT")).toBe(true);
  });
});

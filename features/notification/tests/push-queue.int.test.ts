// consume → notify.push 경로 통합 테스트 (실제 DB·pg-boss + 가짜 푸시 서버): 결재 차례 이벤트가 알림을 만들고 웹 푸시 큐를 거쳐 구독 기기 주소로 나간다
import { createDatabase, withTenant } from "@fmerp/db";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type NotificationJobs, registerNotificationJobs } from "../src/jobs/jobs";
import { saveSubscription } from "../src/service/push";
import { makeSubscriptionKeys, makeVapid, testOpsRules } from "./test-support";

const appDb = createDatabase(process.env.DATABASE_URL ?? "");
const authDb = createDatabase(process.env.AUTH_DATABASE_URL ?? "");
const owner = createDatabase(process.env.MIGRATION_DATABASE_URL ?? "");
const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL ?? "",
  schema: "pgboss_test_push",
});
const logs: string[] = [];
const logger = { info: (m: string) => logs.push(m), error: (m: string) => logs.push(m) };

const MARK = `pqw-${Date.now().toString(36)}`;
const pushed: string[] = [];
const pushFetch = (async (input: string | URL | Request) => {
  pushed.push(String(input));
  return new Response(null, { status: 201 });
}) as typeof fetch;

let accountId = "";
let drafter = "";
let approver = { membershipId: "", userId: "" };
let documentId = "";
let endpoint = "";
let jobs: NotificationJobs | null = null;

async function waitFor(check: () => boolean, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function addEvent(type: string, payload: Record<string, unknown>) {
  await owner.pool.query(
    "insert into approval_event (account_id, document_id, type, payload) values ($1, $2, $3, $4::jsonb)",
    [accountId, documentId, type, JSON.stringify({ type, docId: documentId, ...payload })],
  );
}

beforeAll(async () => {
  boss.on("error", () => {});
  await boss.start();
  await boss.deleteAllJobs();

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
  await owner.pool.query("delete from push_subscription where membership_id = $1", [
    approver.membershipId,
  ]);

  endpoint = `https://push.example.test/${MARK}-approver`;
  const keys = await makeSubscriptionKeys();
  await withTenant(appDb.db, accountId, (tx) =>
    saveSubscription(tx, accountId, approver.membershipId, { endpoint, ...keys }),
  );

  const vapid = await makeVapid();
  jobs = await registerNotificationJobs(boss, {
    appDb: appDb.db,
    authDb: authDb.db,
    baseUrl: "https://erp.test",
    client: null,
    webhook: null,
    vapid,
    pushFetch,
    rules: testOpsRules,
    logger,
  });
}, 60_000);

afterAll(async () => {
  await jobs?.stop();
  await owner.pool.query("delete from push_subscription where membership_id = $1", [
    approver.membershipId,
  ]);
  await owner.pool.query("delete from notification where document_id = $1", [documentId]);
  await owner.pool.query(
    "delete from event_notified where event_id in (select id from approval_event where document_id = $1)",
    [documentId],
  );
  await owner.pool.query("delete from approval_event where document_id = $1", [documentId]);
  await owner.pool.query("delete from document where id = $1", [documentId]);
  await boss.stop({ graceful: false });
  await Promise.all([appDb.pool.end(), authDb.pool.end(), owner.pool.end()]);
});

describe("웹 푸시 발송 경로 (결재 이벤트 → 알림 → 큐 → 구독 기기)", () => {
  it("결재 차례 이벤트가 알림을 만들고 웹 푸시 큐를 거쳐 구독 기기 주소로 발송된다", async () => {
    await addEvent("step_activated", {
      stepId: crypto.randomUUID(),
      assigneeIds: [approver.membershipId],
      delegateIds: [],
    });
    expect(await waitFor(() => pushed.includes(endpoint))).toBe(true);
    const created = await owner.pool.query<{ n: number }>(
      "select count(*)::int as n from notification where document_id = $1 and recipient_membership_id = $2",
      [documentId, approver.membershipId],
    );
    expect(created.rows[0]?.n).toBeGreaterThan(0);
  }, 30_000);

  it("텔레그램 토큰이 없으면(client=null) 같은 알림이 텔레그램 큐에 들어가지 않는다", async () => {
    // 위 테스트가 만든 알림 id를 pg-boss 작업 테이블에서 찾아, 텔레그램 큐 작업이 없는지 확인한다
    const notes = await owner.pool.query<{ id: string }>(
      "select id from notification where document_id = $1 and recipient_membership_id = $2",
      [documentId, approver.membershipId],
    );
    expect(notes.rows.length).toBeGreaterThan(0);
    const ids = notes.rows.map((r) => r.id);
    const telegramJobs = await appDb.pool.query<{ n: number }>(
      `select count(*)::int as n from pgboss_test_push.job
        where name = 'notify.telegram' and data->>'notificationId' = any($1::text[])`,
      [ids],
    );
    expect(telegramJobs.rows[0]?.n).toBe(0);
    const pushJobs = await appDb.pool.query<{ n: number }>(
      `select count(*)::int as n from pgboss_test_push.job
        where name = 'notify.push' and data->>'notificationId' = any($1::text[])`,
      [ids],
    );
    expect(pushJobs.rows[0]?.n).toBeGreaterThan(0);
  }, 30_000);
});

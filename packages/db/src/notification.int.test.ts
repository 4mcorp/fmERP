// M8 통합 테스트: 알림 테이블의 테넌트 격리·권한, 이벤트 조회 함수, 텔레그램 연결 테이블 권한 (실제 DB)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "./index";

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name}이 없습니다`);
  return v;
};
const app = createDatabase(need("DATABASE_URL"));
const auth = createDatabase(need("AUTH_DATABASE_URL"));
const owner = createDatabase(need("MIGRATION_DATABASE_URL"));

const MARK = `m8-db-${Date.now().toString(36)}`;
let accountA = "";
let accountB = "";
let membershipA = "";
let userA = "";

/** 테넌트를 지정해 쿼리한다 (withTenant와 같은 방식) */
async function asTenant<T>(accountId: string, fn: (q: typeof app.pool) => Promise<T>) {
  const client = await app.pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.account_id', $1, true)", [accountId]);
    const result = await fn(client as unknown as typeof app.pool);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

async function clean() {
  await owner.pool.query("delete from notification where dedupe_key like $1", [`${MARK}%`]);
  await owner.pool.query(
    "delete from event_notified where event_id in (select id from approval_event where payload->>'mark' = $1)",
    [MARK],
  );
  await owner.pool.query("delete from approval_event where payload->>'mark' = $1", [MARK]);
  await owner.pool.query("delete from telegram_link_token where token_hash like $1", [`${MARK}%`]);
  await owner.pool.query("delete from telegram_link where user_id = $1", [userA]);
  await owner.pool.query("delete from system_setting where key = 'telegram_update_offset'");
}

beforeAll(async () => {
  const accounts = await owner.pool.query<{ id: string; slug: string }>(
    "select id, slug from account where slug in ('fourm-test', 'other-company')",
  );
  accountA = accounts.rows.find((a) => a.slug === "fourm-test")?.id ?? "";
  accountB = accounts.rows.find((a) => a.slug === "other-company")?.id ?? "";
  const m = await owner.pool.query<{ id: string; user_id: string }>(
    "select id, user_id from membership where account_id = $1 limit 1",
    [accountA],
  );
  membershipA = m.rows[0]?.id ?? "";
  userA = m.rows[0]?.user_id ?? "";
  if (!accountA || !accountB || !membershipA) throw new Error("시드 계정이 없습니다");
  await clean();
});

afterAll(async () => {
  await clean();
  await app.pool.end();
  await auth.pool.end();
  await owner.pool.end();
});

const insertNotification = (q: typeof app.pool, accountId: string, key: string) =>
  q.query<{ id: string }>(
    `insert into notification (account_id, recipient_membership_id, kind, title, dedupe_key)
     values ($1, $2, 'approval_requested', '시험', $3) returning id`,
    [accountId, membershipA, `${MARK}:${key}`],
  );

describe("notification (인앱 알림)", () => {
  it("다른 계정에서는 보이지 않고 다른 계정 id로 쓰기도 거부된다", async () => {
    await asTenant(accountA, (q) => insertNotification(q, accountA, "iso"));
    const own = await asTenant(accountA, (q) =>
      q.query("select id from notification where dedupe_key = $1", [`${MARK}:iso`]),
    );
    expect(own.rowCount).toBe(1);
    const other = await asTenant(accountB, (q) =>
      q.query("select id from notification where dedupe_key = $1", [`${MARK}:iso`]),
    );
    expect(other.rowCount).toBe(0);
    await expect(
      asTenant(accountB, (q) => insertNotification(q, accountA, "cross")),
    ).rejects.toThrow(/row-level security/);
  });

  it("같은 수신자·같은 dedupe_key는 한 번만 만들어진다", async () => {
    await asTenant(accountA, (q) => insertNotification(q, accountA, "dup"));
    await expect(asTenant(accountA, (q) => insertNotification(q, accountA, "dup"))).rejects.toThrow(
      /duplicate key|unique/,
    );
  });

  it("앱 역할은 읽음·텔레그램 상태만 바꾸고 제목 변경·삭제는 못 한다", async () => {
    await asTenant(accountA, (q) => insertNotification(q, accountA, "perm"));
    await asTenant(accountA, (q) =>
      q.query(
        "update notification set read_at = now(), telegram_status = 'SENT' where dedupe_key = $1",
        [`${MARK}:perm`],
      ),
    );
    await expect(
      asTenant(accountA, (q) =>
        q.query("update notification set title = 'x' where dedupe_key = $1", [`${MARK}:perm`]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asTenant(accountA, (q) =>
        q.query("delete from notification where dedupe_key = $1", [`${MARK}:perm`]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("notification_pending_events (교차 계정 이벤트 조회)", () => {
  it("처리 표시가 없는 최근 이벤트만, 계정을 가로질러 돌려준다", async () => {
    const doc = await owner.pool.query<{ id: string }>(
      "select id from document where account_id = $1 limit 1",
      [accountA],
    );
    const documentId = doc.rows[0]?.id;
    // 문서가 없는 환경이면 이 시험은 건너뛴다 (이벤트는 문서 id만 필요하고 FK가 없다)
    const documentRef = documentId ?? "00000000-0000-7000-8000-000000000001";
    const ev = await owner.pool.query<{ id: string }>(
      `insert into approval_event (account_id, document_id, type, payload)
       values ($1, $2, 'submitted', $3::jsonb) returning id`,
      [accountA, documentRef, JSON.stringify({ mark: MARK })],
    );
    const eventId = ev.rows[0]?.id ?? "";

    const before = await app.pool.query<{ event_id: string }>(
      "select * from notification_pending_events(500, interval '1 hour')",
    );
    expect(before.rows.map((r) => r.event_id)).toContain(eventId);

    await asTenant(accountA, (q) =>
      q.query("insert into event_notified (event_id, account_id) values ($1, $2)", [
        eventId,
        accountA,
      ]),
    );
    // 계정을 가로지르는 함수는 이벤트의 위치만 알려 준다 (반려 의견 같은 내용은 돌려주지 않는다)
    expect(before.fields.map((f) => f.name).sort()).toEqual([
      "account_id",
      "document_id",
      "event_id",
      "type",
    ]);
    const after = await app.pool.query<{ event_id: string }>(
      "select event_id from notification_pending_events(500, interval '1 hour')",
    );
    expect(after.rows.map((r) => r.event_id)).not.toContain(eventId);
  });

  it("공개 역할(PUBLIC)에는 실행 권한이 없고 인증 역할도 못 부른다", async () => {
    await expect(
      auth.pool.query("select * from notification_pending_events(1, interval '1 hour')"),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("telegram_link · telegram_link_token · system_setting", () => {
  it("앱 역할은 텔레그램 연결 정보에 접근할 수 없고 인증 역할만 다룬다", async () => {
    await expect(app.pool.query("select * from telegram_link")).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.pool.query("select * from telegram_link_token")).rejects.toThrow(
      /permission denied/,
    );
    await auth.pool.query("insert into telegram_link (user_id, chat_id) values ($1, 424242)", [
      userA,
    ]);
    expect(
      (await auth.pool.query("select 1 from telegram_link where user_id = $1", [userA])).rowCount,
    ).toBe(1);
  });

  it("같은 텔레그램 대화는 한 사용자에게만 묶인다", async () => {
    const other = await owner.pool.query<{ id: string }>(
      'select id from "user" where id <> $1 limit 1',
      [userA],
    );
    const otherId = other.rows[0]?.id;
    await expect(
      auth.pool.query("insert into telegram_link (user_id, chat_id) values ($1, 424242)", [
        otherId,
      ]),
    ).rejects.toThrow(/duplicate key|unique/);
  });

  it("연결 토큰 해시는 중복될 수 없다", async () => {
    const insert = () =>
      auth.pool.query(
        "insert into telegram_link_token (user_id, token_hash, expires_at) values ($1, $2, now() + interval '10 minutes')",
        [userA, `${MARK}-hash`],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key|unique/);
  });

  it("system_setting은 앱 역할이 읽고 쓰지만 지울 수는 없다", async () => {
    await app.pool.query(
      `insert into system_setting (key, value) values ('telegram_update_offset', '5'::jsonb)
       on conflict (key) do update set value = excluded.value`,
    );
    const row = await app.pool.query(
      "select value from system_setting where key = 'telegram_update_offset'",
    );
    expect(row.rows[0]?.value).toBe(5);
    await expect(
      app.pool.query("delete from system_setting where key = 'telegram_update_offset'"),
    ).rejects.toThrow(/permission denied/);
  });
});

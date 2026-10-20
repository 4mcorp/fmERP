// 웹 푸시 통합 테스트 (실제 DB + 가짜 푸시 서버): 구독 저장·해제, 발송, 만료(404·410) 정리, 일시 오류 재시도 신호
import { createDatabase, withTenant } from "@fmerp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PushSendError,
  removeSubscription,
  saveSubscription,
  sendPushNotification,
} from "../src/service/push";

const appDb = createDatabase(process.env.DATABASE_URL ?? "");
const owner = createDatabase(process.env.MIGRATION_DATABASE_URL ?? "");

const MARK = `push-${Date.now().toString(36)}`;
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

/** 실제 P-256 VAPID 키 쌍을 만든다 (공개 키는 65바이트 비압축 점) */
async function makeVapid() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return {
    publicKey: b64url(raw),
    privateKey: jwk.d ?? "",
    subject: "mailto:ops@example.com",
  };
}

/** 브라우저 구독 키(p256dh 점 + auth 16바이트)를 만든다 */
async function makeSubscriptionKeys() {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return {
    p256dh: b64url(raw),
    auth: b64url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

let accountId = "";
let memberMid = "";
let otherMid = "";
let vapid: Awaited<ReturnType<typeof makeVapid>>;
let keys: Awaited<ReturnType<typeof makeSubscriptionKeys>>;
const created: string[] = [];

/** 가짜 푸시 서버: 응답 상태를 정하고 받은 요청을 기록한다 */
function fakePush(status: number) {
  const calls: { url: string; authorization: string | null; bodyBytes: number }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      authorization: headers.get("authorization"),
      bodyBytes: init?.body instanceof Uint8Array ? init.body.byteLength : 0,
    });
    return new Response(null, { status });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

async function seedNotification(membershipId: string) {
  const r = await owner.pool.query<{ id: string }>(
    `insert into notification (account_id, recipient_membership_id, kind, document_id, title, body, external_text, dedupe_key)
     values ($1, $2, 'approval_requested', null, $3, $4, $5, $6) returning id`,
    [
      accountId,
      membershipId,
      `${MARK} 제목`,
      `${MARK} 내용`,
      "새 결재 요청이 있습니다",
      `${MARK}-${crypto.randomUUID()}`,
    ],
  );
  const id = r.rows[0]?.id ?? "";
  created.push(id);
  return id;
}

async function subsOf(membershipId: string) {
  const r = await owner.pool.query<{ endpoint: string }>(
    "select endpoint from push_subscription where membership_id = $1 order by endpoint",
    [membershipId],
  );
  return r.rows.map((x) => x.endpoint);
}

beforeAll(async () => {
  vapid = await makeVapid();
  keys = await makeSubscriptionKeys();
  const a = await owner.pool.query<{ id: string }>(
    "select id from account where slug = 'fourm-test'",
  );
  accountId = a.rows[0]?.id ?? "";
  const m = await owner.pool.query<{ mid: string; email: string }>(
    `select m.id as mid, u.email from membership m join "user" u on u.id = m.user_id
      where m.account_id = $1 and u.email in ('member1@example.com','member2@example.com')`,
    [accountId],
  );
  memberMid = m.rows.find((r) => r.email === "member1@example.com")?.mid ?? "";
  otherMid = m.rows.find((r) => r.email === "member2@example.com")?.mid ?? "";
  await owner.pool.query("delete from push_subscription where account_id = $1", [accountId]);
});

afterAll(async () => {
  await owner.pool.query("delete from push_subscription where account_id = $1", [accountId]);
  if (created.length > 0) {
    await owner.pool.query("delete from notification where id = any($1::uuid[])", [created]);
  }
  await Promise.all([appDb.pool.end(), owner.pool.end()]);
});

describe("웹 푸시 구독 저장·해제 (RLS·구성원 격리)", () => {
  it("구독을 저장하고, 같은 주소는 한 번만 둔다", async () => {
    const endpoint = `https://push.example.test/${MARK}-save`;
    await withTenant(appDb.db, accountId, (tx) =>
      saveSubscription(tx, accountId, memberMid, { endpoint, ...keys }),
    );
    await withTenant(appDb.db, accountId, (tx) =>
      saveSubscription(tx, accountId, memberMid, { endpoint, ...keys }),
    );
    expect(await subsOf(memberMid)).toEqual([endpoint]);
  });

  it("해제는 본인 구독만 지우고, 남의 기기 주소는 건드리지 않는다", async () => {
    const mine = `https://push.example.test/${MARK}-mine`;
    const theirs = `https://push.example.test/${MARK}-theirs`;
    await withTenant(appDb.db, accountId, async (tx) => {
      await saveSubscription(tx, accountId, memberMid, { endpoint: mine, ...keys });
      await saveSubscription(tx, accountId, otherMid, { endpoint: theirs, ...keys });
    });
    // 다른 구성원이 남의 주소를 해제하려 해도 아무 것도 지워지지 않는다
    await withTenant(appDb.db, accountId, (tx) => removeSubscription(tx, memberMid, theirs));
    expect(await subsOf(otherMid)).toContain(theirs);
    // 본인 주소는 지워진다
    await withTenant(appDb.db, accountId, (tx) => removeSubscription(tx, memberMid, mine));
    expect(await subsOf(memberMid)).not.toContain(mine);
  });
});

describe("웹 푸시 발송", () => {
  it("구독 기기에 VAPID 서명·암호화된 요청을 한 번 보낸다", async () => {
    // 앞선 시험이 남긴 구독이 끼지 않게 이 구성원의 구독을 비운다
    await owner.pool.query("delete from push_subscription where membership_id = $1", [memberMid]);
    const endpoint = `https://push.example.test/${MARK}-send`;
    await withTenant(appDb.db, accountId, (tx) =>
      saveSubscription(tx, accountId, memberMid, { endpoint, ...keys }),
    );
    const nid = await seedNotification(memberMid);
    const push = fakePush(201);
    const outcome = await sendPushNotification(
      { appDb: appDb.db, vapid, fetch: push.fetch },
      { accountId, notificationId: nid },
    );
    expect(outcome).toBe("sent");
    expect(push.calls).toHaveLength(1);
    expect(push.calls[0]?.url).toBe(endpoint);
    expect(push.calls[0]?.authorization).toMatch(/^vapid t=.+, k=/);
    expect(push.calls[0]?.bodyBytes).toBeGreaterThan(0);
  });

  it("기기가 없으면 아무것도 보내지 않는다", async () => {
    const nid = await seedNotification(otherMid);
    await owner.pool.query("delete from push_subscription where membership_id = $1", [otherMid]);
    const push = fakePush(201);
    const outcome = await sendPushNotification(
      { appDb: appDb.db, vapid, fetch: push.fetch },
      { accountId, notificationId: nid },
    );
    expect(outcome).toBe("none");
    expect(push.calls).toHaveLength(0);
  });

  it("410(구독 만료)이면 구독을 지우고 재시도하지 않는다", async () => {
    const endpoint = `https://push.example.test/${MARK}-gone`;
    await withTenant(appDb.db, accountId, (tx) =>
      saveSubscription(tx, accountId, memberMid, { endpoint, ...keys }),
    );
    const nid = await seedNotification(memberMid);
    const outcome = await sendPushNotification(
      { appDb: appDb.db, vapid, fetch: fakePush(410).fetch },
      { accountId, notificationId: nid },
    );
    expect(outcome).toBe("gone");
    expect(await subsOf(memberMid)).not.toContain(endpoint);
  });

  it("404도 만료로 보고 구독을 지운다", async () => {
    const endpoint = `https://push.example.test/${MARK}-404`;
    await withTenant(appDb.db, accountId, (tx) =>
      saveSubscription(tx, accountId, memberMid, { endpoint, ...keys }),
    );
    const nid = await seedNotification(memberMid);
    await sendPushNotification(
      { appDb: appDb.db, vapid, fetch: fakePush(404).fetch },
      { accountId, notificationId: nid },
    );
    expect(await subsOf(memberMid)).not.toContain(endpoint);
  });

  it("일시 오류(500)는 구독을 지우지 않고 재시도 신호(PushSendError)를 던진다", async () => {
    const endpoint = `https://push.example.test/${MARK}-retry`;
    await withTenant(appDb.db, accountId, (tx) =>
      saveSubscription(tx, accountId, memberMid, { endpoint, ...keys }),
    );
    const nid = await seedNotification(memberMid);
    const err = await sendPushNotification(
      { appDb: appDb.db, vapid, fetch: fakePush(500).fetch },
      { accountId, notificationId: nid },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PushSendError);
    expect((err as PushSendError).status).toBe(500);
    expect(await subsOf(memberMid)).toContain(endpoint);
  });

  it("알림 행이 없으면 아무것도 하지 않는다", async () => {
    const push = fakePush(201);
    const outcome = await sendPushNotification(
      { appDb: appDb.db, vapid, fetch: push.fetch },
      { accountId, notificationId: crypto.randomUUID() },
    );
    expect(outcome).toBe("none");
    expect(push.calls).toHaveLength(0);
  });
});

// 웹 푸시 구독 HTTP 라우트 통합 테스트 (실제 DB): 401(비로그인), 403(구성원 아님), 본인 구독만 해제, 계정 전환 시 같은 주소 충돌
import { createDatabase, withTenant } from "@fmerp/db";
import {
  clientWithCookie,
  json,
  loginAs,
  type TestClient,
} from "@fmerp/shared/testing/test-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveSubscription } from "../src/service/push";
import { makeSubscriptionKeys } from "./test-support";

const appDb = createDatabase(process.env.DATABASE_URL ?? "");
const owner = createDatabase(process.env.MIGRATION_DATABASE_URL ?? "");
const MARK = `pr-${Date.now().toString(36)}`;
const HEADERS = { "x-forwarded-for": "198.51.100.20" };

const clients: Record<string, TestClient> = {};
const ids: Record<string, string> = {};
let accountId = "";
let otherAccountId = "";
let keys: Awaited<ReturnType<typeof makeSubscriptionKeys>>;

const req = (who: string, path: string, method = "GET", body?: unknown) =>
  (clients[who] as TestClient).request(path, {
    method,
    body: body === undefined && method !== "GET" ? {} : body,
    headers: HEADERS,
  });
const subscribe = (who: string, endpoint: string) =>
  req(who, "/api/me/push/subscribe", "POST", { endpoint, keys });
const endpointsOf = async (membershipId: string) =>
  (
    await owner.pool.query<{ endpoint: string }>(
      "select endpoint from push_subscription where membership_id = $1 order by endpoint",
      [membershipId],
    )
  ).rows.map((r) => r.endpoint);

beforeAll(async () => {
  keys = await makeSubscriptionKeys();
  for (const [key, email] of [
    ["member1", "member1@example.com"],
    ["member2", "member2@example.com"],
    ["otherOwner", "owner-b@example.com"],
  ] as const) {
    clients[key] = await loginAs(email);
  }
  const rows = await owner.pool.query<{ email: string; mid: string; aid: string; slug: string }>(
    `select u.email, m.id as mid, m.account_id as aid, a.slug from membership m
       join "user" u on u.id = m.user_id join account a on a.id = m.account_id
      where u.email = any($1::text[]) and a.slug in ('fourm-test', 'other-company')`,
    [["member1@example.com", "member2@example.com", "owner-b@example.com"]],
  );
  const by = (email: string, slug: string) =>
    rows.rows.find((r) => r.email === email && r.slug === slug);
  accountId = by("member1@example.com", "fourm-test")?.aid ?? "";
  otherAccountId = by("owner-b@example.com", "other-company")?.aid ?? "";
  ids.member1 = by("member1@example.com", "fourm-test")?.mid ?? "";
  ids.member2 = by("member2@example.com", "fourm-test")?.mid ?? "";
  ids.otherOwner = by("owner-b@example.com", "other-company")?.mid ?? "";
  await req("member1", "/api/accounts/active", "POST", { accountId });
  await req("member2", "/api/accounts/active", "POST", { accountId });
  await req("otherOwner", "/api/accounts/active", "POST", { accountId: otherAccountId });
});

afterAll(async () => {
  await owner.pool.query("delete from push_subscription where endpoint like $1", [
    `https://push.example.test/${MARK}%`,
  ]);
  await owner.pool.query("update membership set status = 'active' where id = $1", [ids.member2]);
  await owner.pool.end();
  await appDb.pool.end();
});

describe("웹 푸시 구독 API", () => {
  it("로그인하지 않으면 설정·구독·해제 모두 401이다", async () => {
    const anon = clientWithCookie("");
    expect((await anon.request("/api/me/push/config")).status).toBe(401);
    const sub = await anon.request("/api/me/push/subscribe", {
      method: "POST",
      body: { endpoint: `https://push.example.test/${MARK}-anon`, keys },
    });
    expect(sub.status).toBe(401);
    const unsub = await anon.request("/api/me/push/unsubscribe", {
      method: "POST",
      body: { endpoint: `https://push.example.test/${MARK}-anon` },
    });
    expect(unsub.status).toBe(401);
  });

  it("VAPID 키가 없으면 설정 응답의 publicKey는 null이다 (푸시만 꺼짐)", async () => {
    const res = await req("member1", "/api/me/push/config");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ publicKey: null });
  });

  it("구독을 저장하면 본인 구성원 소속으로 남는다", async () => {
    const endpoint = `https://push.example.test/${MARK}-save`;
    expect((await subscribe("member1", endpoint)).status).toBe(200);
    expect(await endpointsOf(ids.member1 ?? "")).toContain(endpoint);
  });

  it("다른 구성원의 해제 요청은 남의 구독을 지우지 못하고, 본인 해제만 지워진다", async () => {
    const mine = `https://push.example.test/${MARK}-mine`;
    const theirs = `https://push.example.test/${MARK}-theirs`;
    await subscribe("member1", mine);
    await subscribe("member2", theirs);

    expect(
      (await req("member1", "/api/me/push/unsubscribe", "POST", { endpoint: theirs })).status,
    ).toBe(200);
    expect(await endpointsOf(ids.member2 ?? "")).toContain(theirs);

    expect(
      (await req("member1", "/api/me/push/unsubscribe", "POST", { endpoint: mine })).status,
    ).toBe(200);
    expect(await endpointsOf(ids.member1 ?? "")).not.toContain(mine);
  });

  it("이 회사에서 활성 구성원이 아니면 403이다", async () => {
    await owner.pool.query("update membership set status = 'leave' where id = $1", [ids.member2]);
    try {
      const res = await subscribe("member2", `https://push.example.test/${MARK}-outsider`);
      expect(res.status).toBe(403);
    } finally {
      await owner.pool.query("update membership set status = 'active' where id = $1", [
        ids.member2,
      ]);
    }
  });

  it("다른 계정이 쓰던 주소를 구독하면 500이 아니라 409로 막는다 (행은 원래 계정 소속 그대로)", async () => {
    const shared = `https://push.example.test/${MARK}-other-account`;
    await withTenant(appDb.db, otherAccountId, (tx) =>
      saveSubscription(tx, otherAccountId, ids.otherOwner ?? "", { endpoint: shared, ...keys }),
    );
    const res = await subscribe("member1", shared);
    expect(res.status).toBe(409);
    const row = await owner.pool.query<{ account_id: string }>(
      "select account_id from push_subscription where endpoint = $1",
      [shared],
    );
    expect(row.rows[0]?.account_id).toBe(otherAccountId);
  });
});

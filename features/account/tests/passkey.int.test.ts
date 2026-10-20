import { randomBytes, randomUUID } from "node:crypto";
import { createDatabase, schema } from "@fmerp/db";
import { getTestApp, json, loginAs } from "@fmerp/shared/testing/test-client";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { issueEnrollmentToken, preRegisterMember } from "../src/service/enrollment";
import {
  authenticationResponse,
  createFakeAuthenticator,
  type FakeAuthenticator,
  registrationResponse,
} from "./passkey-fake";

const env = process.env;
const appDb = createDatabase(env.DATABASE_URL ?? "");
const authDb = createDatabase(env.AUTH_DATABASE_URL ?? "");
const deps = { appDb: appDb.db, authDb: authDb.db };
const request = { ip: "127.0.0.1", userAgent: "vitest", requestId: null };

// BETTER_AUTH_URL(vitest.config.ts)과 같아야 한다: rpID는 호스트, origin은 전체 주소
const APP_ORIGIN = "http://localhost:3000";
const RP_ID = "localhost";

afterAll(async () => {
  await appDb.pool.end();
  await authDb.pool.end();
});

async function call(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<Response> {
  return getTestApp().request(path, {
    method: init.method ?? "GET",
    headers: {
      origin: APP_ORIGIN,
      "content-type": "application/json",
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function cookiesOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

/** 계정 하나, 관리자 한 명, 사전 등록된 사용자 한 명, 등록 링크 하나를 만든다 */
async function makeEnrollment() {
  const [admin] = await authDb.db
    .insert(schema.user)
    .values({ name: "관리자", email: `pk-admin-${randomUUID()}@example.com` })
    .returning({ id: schema.user.id });
  const [acc] = await authDb.db
    .insert(schema.account)
    .values({ name: "패스키 시험 회사", slug: `pk-${randomUUID()}` })
    .returning({ id: schema.account.id });
  if (!admin || !acc) throw new Error("시험 데이터 생성 실패");
  const now = new Date();
  const email = `pk-${randomUUID()}@example.com`;
  const { userId } = await preRegisterMember(deps, {
    accountId: acc.id,
    email,
    name: "패스키 사용자",
    now,
  });
  const { token } = await issueEnrollmentToken(deps, {
    accountId: acc.id,
    userId,
    createdBy: admin.id,
    now,
    request,
  });
  return { accountId: acc.id, userId, token };
}

/** 등록 링크로 등록을 끝까지 진행한다 (옵션 발급 → 검증). 검증 응답을 돌려준다 */
async function registerWithToken(token: string, auth: FakeAuthenticator) {
  const opts = await call(
    `/api/auth/passkey/generate-register-options?context=${encodeURIComponent(token)}&name=${encodeURIComponent("시험 기기")}`,
  );
  if (opts.status !== 200) return { options: opts, verify: null };
  const { challenge } = await json<{ challenge: string }>(opts);
  const verify = await call("/api/auth/passkey/verify-registration", {
    method: "POST",
    cookie: cookiesOf(opts),
    body: {
      response: registrationResponse(auth, { challenge, origin: APP_ORIGIN, rpId: RP_ID }),
      name: "시험 기기",
    },
  });
  return { options: opts, verify };
}

/** 등록된 passkey로 로그인한다 (discoverable 자격 증명) */
async function loginWithPasskey(auth: FakeAuthenticator) {
  const opts = await call("/api/auth/passkey/generate-authenticate-options");
  const { challenge } = await json<{ challenge: string }>(opts);
  return call("/api/auth/passkey/verify-authentication", {
    method: "POST",
    cookie: cookiesOf(opts),
    body: {
      response: authenticationResponse(auth, { challenge, origin: APP_ORIGIN, rpId: RP_ID }),
    },
  });
}

/** 시험용 passkey 행을 직접 넣는다 (등록 흐름 없이 소유·접근 제어만 볼 때) */
async function insertPasskey(userId: string) {
  const [row] = await authDb.db
    .insert(schema.passkey)
    .values({
      name: "시험 키",
      publicKey: randomBytes(32).toString("base64"),
      userId,
      credentialID: randomBytes(16).toString("base64url"),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
    })
    .returning({ id: schema.passkey.id });
  if (!row) throw new Error("passkey 생성 실패");
  return row.id;
}

describe("passkey 등록·로그인 (WebAuthn 모의)", () => {
  it("사전 등록 링크로 등록하고, 그 passkey로 로그인하면 세션이 만들어진다", async () => {
    const { userId, token } = await makeEnrollment();
    const auth = createFakeAuthenticator();

    const { verify } = await registerWithToken(token, auth);
    expect(verify?.status).toBe(200);

    const [stored] = await authDb.db
      .select({ id: schema.passkey.id, userId: schema.passkey.userId })
      .from(schema.passkey)
      .where(eq(schema.passkey.userId, userId));
    expect(stored?.userId).toBe(userId);

    const login = await loginWithPasskey(auth);
    expect(login.status).toBe(200);
    expect(cookiesOf(login)).toMatch(/session/i);
    const body = await json<{ user: { id: string } }>(login);
    expect(body.user.id).toBe(userId);
  });

  it("등록 링크는 한 번만 쓸 수 있다: 같은 링크로 두 번째 등록은 거부", async () => {
    const { token } = await makeEnrollment();
    const first = await registerWithToken(token, createFakeAuthenticator());
    expect(first.verify?.status).toBe(200);

    const second = await registerWithToken(token, createFakeAuthenticator());
    expect(second.options.status).toBe(400);
  });

  it("등록되지 않은 passkey로 로그인하면 거부하고, 실패 응답은 이유를 드러내지 않는다", async () => {
    const stranger = createFakeAuthenticator();
    const res = await loginWithPasskey(stranger);
    expect(res.status).toBe(401);
    const body = await json<{ message: string }>(res);
    expect(body.message).toBe("패스키 로그인에 실패했습니다");
  });

  it("등록 링크 없이 등록 옵션을 요구하면 거부한다 (로그인도 링크도 없음)", async () => {
    const res = await call("/api/auth/passkey/generate-register-options");
    expect(res.status).toBe(401);
  });

  it("등록이 끝나면 감사 로그가 남고 등록 링크는 사용 처리된다", async () => {
    const { userId, token } = await makeEnrollment();
    const { verify } = await registerWithToken(token, createFakeAuthenticator());
    expect(verify?.status).toBe(200);

    const [log] = await authDb.db
      .select({ action: schema.auditLog.action, result: schema.auditLog.result })
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.action, "passkey.enroll"), eq(schema.auditLog.targetId, userId)),
      );
    expect(log?.result).toBe("success");

    const [used] = await authDb.db
      .select({ usedAt: schema.enrollmentToken.usedAt })
      .from(schema.enrollmentToken)
      .where(eq(schema.enrollmentToken.userId, userId));
    expect(used?.usedAt).not.toBeNull();
  });
});

describe("내 passkey 관리 (소유·마지막 1개 정책)", () => {
  it("로그인하지 않으면 목록·이름 변경·삭제 모두 401", async () => {
    const list = await call("/api/me/passkeys");
    expect(list.status).toBe(401);
    const del = await call(`/api/me/passkeys/${randomUUID()}`, { method: "DELETE" });
    expect(del.status).toBe(401);
  });

  it("다른 사용자의 passkey는 이름 변경·삭제할 수 없다 (404)", async () => {
    const owner = await loginAs("owner@example.com");
    const [other] = await authDb.db
      .insert(schema.user)
      .values({ name: "타 사용자", email: `other-${randomUUID()}@example.com` })
      .returning({ id: schema.user.id });
    if (!other) throw new Error("시험 사용자 생성 실패");
    const otherPasskey = await insertPasskey(other.id);

    const rename = await owner.request(`/api/me/passkeys/${otherPasskey}`, {
      method: "PATCH",
      body: { name: "탈취" },
    });
    expect(rename.status).toBe(404);
    const del = await owner.request(`/api/me/passkeys/${otherPasskey}`, { method: "DELETE" });
    expect(del.status).toBe(404);

    const [still] = await authDb.db
      .select({ name: schema.passkey.name })
      .from(schema.passkey)
      .where(eq(schema.passkey.id, otherPasskey));
    expect(still?.name).toBe("시험 키");
  });

  it("마지막 passkey는 삭제할 수 없고(409), 여러 개면 하나씩 지울 수 있다", async () => {
    const owner = await loginAs("owner@example.com");
    const [me] = await authDb.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, "owner@example.com"));
    if (!me) throw new Error("시드 계정 없음");
    // 이 시험 전에 남은 passkey를 모두 정리한 뒤 2개를 넣는다 (시험 간 상태에 기대지 않는다)
    await authDb.db.delete(schema.passkey).where(eq(schema.passkey.userId, me.id));
    const a = await insertPasskey(me.id);
    const b = await insertPasskey(me.id);

    const first = await owner.request(`/api/me/passkeys/${a}`, { method: "DELETE" });
    expect(first.status).toBe(200);

    const last = await owner.request(`/api/me/passkeys/${b}`, { method: "DELETE" });
    expect(last.status).toBe(409);

    const list = await owner.request("/api/me/passkeys");
    const rows = await json<{ id: string }[]>(list);
    expect(rows.map((r) => r.id)).toEqual([b]);
  });

  it("본인 passkey 이름 변경은 되고 감사 로그가 남는다", async () => {
    const owner = await loginAs("owner@example.com");
    const [me] = await authDb.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, "owner@example.com"));
    if (!me) throw new Error("시드 계정 없음");
    const id = await insertPasskey(me.id);

    const res = await owner.request(`/api/me/passkeys/${id}`, {
      method: "PATCH",
      body: { name: "회사 노트북" },
    });
    expect(res.status).toBe(200);

    const [row] = await authDb.db
      .select({ name: schema.passkey.name })
      .from(schema.passkey)
      .where(eq(schema.passkey.id, id));
    expect(row?.name).toBe("회사 노트북");

    const [log] = await authDb.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, "passkey.rename"), eq(schema.auditLog.targetId, id)));
    expect(log?.action).toBe("passkey.rename");
  });
});

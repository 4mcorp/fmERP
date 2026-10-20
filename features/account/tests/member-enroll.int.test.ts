import { randomBytes, randomUUID } from "node:crypto";
import { createDatabase, schema, withTenant } from "@fmerp/db";
import { json, loginAs } from "@fmerp/shared/testing/test-client";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyEnrollmentToken } from "../src/service/enrollment";

// 관리자 사전 등록·등록 링크 재발급 API (PK1d). 시드 회사(fourm-test)와 시드 계정을 쓴다.
const env = process.env;
const appDb = createDatabase(env.DATABASE_URL ?? "");
const authDb = createDatabase(env.AUTH_DATABASE_URL ?? "");
const migratorDb = createDatabase(env.MIGRATION_DATABASE_URL ?? "");
const verifyDeps = { authDb: authDb.db };

const ADMIN_PIN = "864210";
let adminId = "";
let fourmId = "";

afterAll(async () => {
  await clearAdminPin();
  await appDb.pool.end();
  await authDb.pool.end();
  await migratorDb.pool.end();
});

async function userIdOf(email: string) {
  const [row] = await authDb.db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email));
  if (!row) throw new Error(`시드 사용자 없음: ${email}`);
  return row.id;
}

// fmerp_auth 역할에는 approval_pin DELETE 권한이 없어 마이그레이션 역할로 지운다 (passkey 시험과 같은 방식)
async function clearAdminPin() {
  if (!adminId) return;
  await migratorDb.pool.query("delete from approval_pin where user_id = $1", [adminId]);
}

/** 관리자 로그인 후 PIN을 확인해 세션에 재인증 시각을 남긴다 */
async function adminWithReauth() {
  const admin = await loginAs("admin@example.com");
  const verified = await admin.request("/api/me/pin/verify", {
    method: "POST",
    body: { pin: ADMIN_PIN },
  });
  expect(verified.status).toBe(200);
  return admin;
}

/** 이 회사 구성원이 아닌 새 사용자 (passkey 유무 선택) */
async function makeUser(opts: { passkey?: boolean } = {}) {
  const email = `ext-${randomUUID()}@example.com`;
  const [row] = await authDb.db
    .insert(schema.user)
    .values({ name: "외부 사용자", email, emailVerified: false })
    .returning({ id: schema.user.id });
  if (!row) throw new Error("시험 사용자 생성 실패");
  if (opts.passkey) {
    await authDb.db.insert(schema.passkey).values({
      name: "시험 키",
      publicKey: randomBytes(32).toString("base64"),
      userId: row.id,
      credentialID: randomBytes(16).toString("base64url"),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
    });
  }
  return { id: row.id, email };
}

async function membershipCountIn(accountId: string, userId: string) {
  const rows = await authDb.db
    .select({ id: schema.membership.id })
    .from(schema.membership)
    .where(and(eq(schema.membership.accountId, accountId), eq(schema.membership.userId, userId)));
  return rows.length;
}

describe("관리자 사전 등록·등록 링크 재발급 API (PK1d)", () => {
  beforeAll(async () => {
    adminId = await userIdOf("admin@example.com");
    const [acc] = await authDb.db
      .select({ id: schema.account.id })
      .from(schema.account)
      .where(eq(schema.account.slug, "fourm-test"));
    if (!acc) throw new Error("시드 회사 없음");
    fourmId = acc.id;

    await clearAdminPin();
    const admin = await loginAs("admin@example.com");
    const set = await admin.request("/api/me/pin", { method: "PUT", body: { pin: ADMIN_PIN } });
    expect(set.status).toBe(200);
  });

  it("관리자는 재인증 후 사전 등록하고 등록 링크를 받는다. 링크는 검증되고 감사 로그가 남는다", async () => {
    const admin = await adminWithReauth();
    const email = `pre-${randomUUID()}@example.com`;
    const res = await admin.request("/api/account/members", {
      method: "POST",
      body: { email, name: "  신규 직원  " },
    });
    expect(res.status).toBe(201);
    const body = await json<{ userId: string; created: boolean; token: string; expiresAt: string }>(
      res,
    );
    expect(body.created).toBe(true);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());

    // 이름은 공백을 지우고 저장된다
    const [user] = await authDb.db
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, body.userId));
    expect(user?.name).toBe("신규 직원");

    // 받은 링크로 등록 검증이 통과한다
    const verified = await verifyEnrollmentToken(verifyDeps, {
      token: body.token,
      now: new Date(),
    });
    expect(verified).toMatchObject({ userId: body.userId, accountId: fourmId });

    // 토큰 원문은 DB에 없고 해시만 있다
    const rows = await authDb.db
      .select({ tokenHash: schema.enrollmentToken.tokenHash })
      .from(schema.enrollmentToken)
      .where(eq(schema.enrollmentToken.userId, body.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toContain(body.token);

    // 감사: 사전 등록과 발급이 모두 남고, 원문 토큰은 없다
    const logs = await authDb.db
      .select({
        action: schema.auditLog.action,
        actorUserId: schema.auditLog.actorUserId,
        accountId: schema.auditLog.accountId,
        reason: schema.auditLog.reason,
      })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.targetId, body.userId),
          inArray(schema.auditLog.action, ["member.pre_register", "member.enrollment_issue"]),
        ),
      );
    expect(logs.map((l) => l.action).sort()).toEqual([
      "member.enrollment_issue",
      "member.pre_register",
    ]);
    for (const log of logs) {
      expect(log.actorUserId).toBe(adminId);
      expect(log.accountId).toBe(fourmId);
    }
    expect(JSON.stringify(logs)).not.toContain(body.token);
  });

  it("일반 구성원은 403이고 사용자·구성원 행을 만들지 못한다", async () => {
    const member = await loginAs("member1@example.com");
    const email = `denied-${randomUUID()}@example.com`;
    const res = await member.request("/api/account/members", {
      method: "POST",
      body: { email, name: "거부" },
    });
    expect(res.status).toBe(403);
    const users = await authDb.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email));
    expect(users).toHaveLength(0);
  });

  it("재인증(PIN 확인)이 없는 관리자는 428이고 아무것도 만들지 않는다", async () => {
    const admin = await loginAs("admin@example.com");
    const email = `noreauth-${randomUUID()}@example.com`;
    const res = await admin.request("/api/account/members", {
      method: "POST",
      body: { email, name: "재인증 없음" },
    });
    expect(res.status).toBe(428);
    expect(await json(res)).toMatchObject({ code: "reauth_required" });
    const users = await authDb.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email));
    expect(users).toHaveLength(0);
  });

  it("이미 이 회사 구성원인 이메일은 409이고 이름을 바꾸지 않는다", async () => {
    const admin = await adminWithReauth();
    const memberId = await userIdOf("member1@example.com");
    const [before] = await authDb.db
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, memberId));

    const res = await admin.request("/api/account/members", {
      method: "POST",
      body: { email: "member1@example.com", name: "바뀌면 안 됨" },
    });
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ code: "member_exists" });

    const [after] = await authDb.db
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, memberId));
    expect(after?.name).toBe(before?.name);
  });

  it("다른 회사 소속이거나 passkey가 있는 사람의 이메일은 409로 거부하고 이 회사로 옮기지 않는다", async () => {
    const admin = await adminWithReauth();

    const otherCompanyId = await userIdOf("owner-b@example.com");
    const other = await admin.request("/api/account/members", {
      method: "POST",
      body: { email: "owner-b@example.com", name: "넘겨받기 시도" },
    });
    expect(other.status).toBe(409);
    const otherBody = await json(other);
    expect(otherBody).toMatchObject({ code: "enrollment_email_unavailable" });
    expect(await membershipCountIn(fourmId, otherCompanyId)).toBe(0);

    const withKey = await makeUser({ passkey: true });
    const keyRes = await admin.request("/api/account/members", {
      method: "POST",
      body: { email: withKey.email, name: "키 보유" },
    });
    expect(keyRes.status).toBe(409);
    const keyBody = await json(keyRes);
    expect(keyBody).toMatchObject({ code: "enrollment_email_unavailable" });
    expect(await membershipCountIn(fourmId, withKey.id)).toBe(0);

    // 소속도 passkey도 없는 고아 계정(이메일만 일치)도 같은 응답으로 거부한다
    const orphan = await makeUser();
    const orphanRes = await admin.request("/api/account/members", {
      method: "POST",
      body: { email: orphan.email, name: "고아 계정" },
    });
    expect(orphanRes.status).toBe(409);
    const orphanBody = await json(orphanRes);
    expect(await membershipCountIn(fourmId, orphan.id)).toBe(0);

    // 세 거부 사유의 응답 본문은 같아야 한다 (사유 노출 금지)
    expect(keyBody).toEqual(otherBody);
    expect(orphanBody).toEqual(otherBody);
  });

  it("거부한 사유는 감사 로그에만 남는다 (응답·본문에는 없다)", async () => {
    const admin = await adminWithReauth();
    const orphan = await makeUser();
    const res = await admin.request("/api/account/members", {
      method: "POST",
      body: { email: orphan.email, name: "감사 확인" },
    });
    expect(res.status).toBe(409);
    expect(JSON.stringify(await json(res))).not.toContain("orphan_account");

    const logs = await withTenant(appDb.db, fourmId, (tx) =>
      tx
        .select({
          action: schema.auditLog.action,
          result: schema.auditLog.result,
          reason: schema.auditLog.reason,
          subjectUserId: schema.auditLog.subjectUserId,
        })
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.action, "member.pre_register"),
            eq(schema.auditLog.subjectUserId, orphan.id),
          ),
        ),
    );
    expect(logs).toEqual([
      {
        action: "member.pre_register",
        result: "failure",
        reason: "orphan_account",
        subjectUserId: orphan.id,
      },
    ]);
  });

  it("잘못된 이메일이나 빈 이름은 400이다", async () => {
    const admin = await adminWithReauth();
    const badEmail = await admin.request("/api/account/members", {
      method: "POST",
      body: { email: "not-an-email", name: "x" },
    });
    expect(badEmail.status).toBe(400);

    const blankName = await admin.request("/api/account/members", {
      method: "POST",
      body: { email: `blank-${randomUUID()}@example.com`, name: "   " },
    });
    expect(blankName.status).toBe(400);
  });

  it("재발급: passkey가 없는 구성원은 새 링크를 받고, 이전 링크는 무효가 된다", async () => {
    const admin = await adminWithReauth();
    const email = `reissue-${randomUUID()}@example.com`;
    const first = await admin.request("/api/account/members", {
      method: "POST",
      body: { email, name: "재발급 대상" },
    });
    expect(first.status).toBe(201);
    const created = await json<{ userId: string; token: string }>(first);

    const again = await admin.request(`/api/account/members/${created.userId}/enrollment`, {
      method: "POST",
    });
    expect(again.status).toBe(200);
    const reissued = await json<{ token: string; expiresAt: string }>(again);
    expect(reissued.token).not.toBe(created.token);

    await expect(
      verifyEnrollmentToken(verifyDeps, { token: created.token, now: new Date() }),
    ).rejects.toMatchObject({ code: "enrollment_invalid" });
    const verified = await verifyEnrollmentToken(verifyDeps, {
      token: reissued.token,
      now: new Date(),
    });
    expect(verified.userId).toBe(created.userId);

    const [log] = await authDb.db
      .select({ actor: schema.auditLog.actorUserId, result: schema.auditLog.result })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, "member.enrollment_issue"),
          eq(schema.auditLog.targetId, created.userId),
        ),
      );
    expect(log?.actor).toBe(adminId);
    expect(log?.result).toBe("success");
  });

  it("재발급: passkey가 이미 있으면 409(has_passkey)로 거부한다", async () => {
    const admin = await adminWithReauth();
    const target = await makeUser({ passkey: true });
    // 이 회사 구성원으로 만든 뒤 passkey를 준비한다 (구성원이 아니면 404가 먼저 난다)
    await authDb.db.insert(schema.membership).values({
      accountId: fourmId,
      userId: target.id,
      role: "member",
      status: "active",
      joinedAt: new Date(),
    });
    const res = await admin.request(`/api/account/members/${target.id}/enrollment`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ code: "has_passkey" });
  });

  it("재발급: 이 회사 구성원이 아닌 사용자는 404다", async () => {
    const admin = await adminWithReauth();
    const otherId = await userIdOf("owner-b@example.com");
    const res = await admin.request(`/api/account/members/${otherId}/enrollment`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("재발급: 재인증 없이는 428이다", async () => {
    const admin = await adminWithReauth();
    const email = `reauth-${randomUUID()}@example.com`;
    const created = await admin.request("/api/account/members", {
      method: "POST",
      body: { email, name: "재인증 재발급" },
    });
    expect(created.status).toBe(201);
    const { userId } = await json<{ userId: string }>(created);

    const noReauth = await loginAs("admin@example.com");
    const res = await noReauth.request(`/api/account/members/${userId}/enrollment`, {
      method: "POST",
    });
    expect(res.status).toBe(428);
  });

  it("재발급: 소유자 계정은 관리자가 재발급할 수 없다 (403)", async () => {
    const admin = await adminWithReauth();
    const ownerId = await userIdOf("owner@example.com");
    const res = await admin.request(`/api/account/members/${ownerId}/enrollment`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });
});

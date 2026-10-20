import { randomUUID } from "node:crypto";
import { createDatabase, schema, withTenant } from "@fmerp/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  consumeEnrollmentToken,
  issueEnrollmentToken,
  preRegisterMember,
  verifyEnrollmentToken,
} from "../src/service/enrollment";

const env = process.env;
const appDb = createDatabase(env.DATABASE_URL ?? "");
const authDb = createDatabase(env.AUTH_DATABASE_URL ?? "");
const deps = { appDb: appDb.db, authDb: authDb.db };
const request = { ip: "127.0.0.1", userAgent: "vitest", requestId: null };
const NOW = new Date();

afterAll(async () => {
  await appDb.pool.end();
  await authDb.pool.end();
});

/** 계정 하나와 관리자 한 명을 만든다 (테스트마다 새 식별자) */
async function makeAccountWithAdmin() {
  const [admin] = await authDb.db
    .insert(schema.user)
    .values({ name: "관리자", email: `admin-${randomUUID()}@example.com` })
    .returning({ id: schema.user.id });
  const [acc] = await authDb.db
    .insert(schema.account)
    .values({ name: "시험 회사", slug: `enr-${randomUUID()}` })
    .returning({ id: schema.account.id });
  if (!admin || !acc) throw new Error("시험 데이터 생성 실패");
  return { adminId: admin.id, accountId: acc.id };
}

describe("사전 등록 사용자", () => {
  it("사용자와 구성원 행을 만들고, 같은 이메일을 다시 넣으면 중복 없이 기존 사용자를 쓴다", async () => {
    const { accountId } = await makeAccountWithAdmin();
    const email = `Pre-${randomUUID()}@Example.com`;

    const first = await preRegisterMember(deps, { accountId, email, name: " 김철수 ", now: NOW });
    expect(first.created).toBe(true);

    const [user] = await authDb.db
      .select({ name: schema.user.name, email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, first.userId));
    expect(user?.name).toBe("김철수");
    expect(user?.email).toBe(email.toLowerCase());

    const again = await preRegisterMember(deps, {
      accountId,
      email: email.toUpperCase(),
      name: "다른 이름",
      now: NOW,
    });
    expect(again).toEqual({ userId: first.userId, created: false, joined: false });

    const members = await authDb.db
      .select({ id: schema.membership.id })
      .from(schema.membership)
      .where(eq(schema.membership.userId, first.userId));
    expect(members).toHaveLength(1);
  });

  it("이 계정에 속하지 않은 기존 사용자(고아 계정·타 회사·passkey 보유)는 구성원으로 붙이지 않고 사유를 돌려준다", async () => {
    const { accountId } = await makeAccountWithAdmin();
    const other = await makeAccountWithAdmin();

    // 고아 계정: 사용자만 있고 소속·passkey 없음
    const orphanEmail = `orphan-${randomUUID()}@example.com`;
    const [orphan] = await authDb.db
      .insert(schema.user)
      .values({ name: "고아", email: orphanEmail, emailVerified: false })
      .returning({ id: schema.user.id });
    if (!orphan) throw new Error("고아 사용자 생성 실패");
    const orphanResult = await preRegisterMember(deps, {
      accountId,
      email: orphanEmail,
      name: "바뀌면 안 됨",
      now: NOW,
    });
    expect(orphanResult).toEqual({
      userId: orphan.id,
      created: false,
      joined: false,
      rejected: "orphan_account",
    });

    // 타 회사 소속
    const otherEmail = `taken-${randomUUID()}@example.com`;
    const { userId: otherUserId } = await preRegisterMember(deps, {
      accountId: other.accountId,
      email: otherEmail,
      name: "타사",
      now: NOW,
    });
    const takenResult = await preRegisterMember(deps, {
      accountId,
      email: otherEmail,
      name: "넘겨받기",
      now: NOW,
    });
    expect(takenResult).toMatchObject({
      userId: otherUserId,
      joined: false,
      rejected: "other_company",
    });

    // 이 계정 구성원이 아님을 확인 (세 경우 모두 membership 행이 생기지 않는다)
    const rows = await authDb.db
      .select({ id: schema.membership.id })
      .from(schema.membership)
      .where(eq(schema.membership.accountId, accountId));
    expect(rows).toHaveLength(0);
  });

  it("잘못된 이메일이면 DB를 건드리지 않고 거부한다", async () => {
    const { accountId } = await makeAccountWithAdmin();
    await expect(
      preRegisterMember(deps, { accountId, email: "not-an-email", name: "x", now: NOW }),
    ).rejects.toMatchObject({ code: "enrollment_email_invalid" });
  });
});

describe("등록 토큰 발급·검증·사용", () => {
  it("토큰 원문은 DB에 없고 해시만 있으며, 확인 후 한 번만 쓸 수 있다", async () => {
    const { adminId, accountId } = await makeAccountWithAdmin();
    const { userId } = await preRegisterMember(deps, {
      accountId,
      email: `u-${randomUUID()}@example.com`,
      name: "사용자",
      now: NOW,
    });
    const issued = await issueEnrollmentToken(deps, {
      accountId,
      userId,
      createdBy: adminId,
      now: NOW,
      request,
    });

    const rows = await withTenant(appDb.db, accountId, (tx) =>
      tx
        .select({ tokenHash: schema.enrollmentToken.tokenHash })
        .from(schema.enrollmentToken)
        .where(eq(schema.enrollmentToken.userId, userId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(issued.token);
    expect(rows[0]?.tokenHash).not.toContain(issued.token);

    const verified = await verifyEnrollmentToken(deps, { token: issued.token, now: NOW });
    expect(verified).toMatchObject({ userId, accountId });

    await consumeEnrollmentToken(deps, { tokenId: verified.tokenId, now: NOW });
    await expect(
      consumeEnrollmentToken(deps, { tokenId: verified.tokenId, now: NOW }),
    ).rejects.toMatchObject({ code: "enrollment_invalid" });
    await expect(
      verifyEnrollmentToken(deps, { token: issued.token, now: NOW }),
    ).rejects.toMatchObject({ code: "enrollment_invalid" });
  });

  it("재발급하면 이전 토큰은 폐기되어 쓸 수 없고, 새 토큰만 쓸 수 있다", async () => {
    const { adminId, accountId } = await makeAccountWithAdmin();
    const { userId } = await preRegisterMember(deps, {
      accountId,
      email: `r-${randomUUID()}@example.com`,
      name: "재발급",
      now: NOW,
    });
    const first = await issueEnrollmentToken(deps, {
      accountId,
      userId,
      createdBy: adminId,
      now: NOW,
      request,
    });
    const second = await issueEnrollmentToken(deps, {
      accountId,
      userId,
      createdBy: adminId,
      now: NOW,
      request,
    });

    await expect(
      verifyEnrollmentToken(deps, { token: first.token, now: NOW }),
    ).rejects.toMatchObject({ code: "enrollment_invalid" });
    const verified = await verifyEnrollmentToken(deps, { token: second.token, now: NOW });
    expect(verified.userId).toBe(userId);
  });

  it("만료된 토큰은 거부한다", async () => {
    const { adminId, accountId } = await makeAccountWithAdmin();
    const { userId } = await preRegisterMember(deps, {
      accountId,
      email: `e-${randomUUID()}@example.com`,
      name: "만료",
      now: NOW,
    });
    const issued = await issueEnrollmentToken(deps, {
      accountId,
      userId,
      createdBy: adminId,
      now: NOW,
      request,
      ttlMs: 1000,
    });
    const later = new Date(issued.expiresAt.getTime() + 1);
    await expect(
      verifyEnrollmentToken(deps, { token: issued.token, now: later }),
    ).rejects.toMatchObject({ code: "enrollment_invalid" });
  });

  it("발급 사실은 감사 로그에 남기되 토큰 원문은 남기지 않는다", async () => {
    const { adminId, accountId } = await makeAccountWithAdmin();
    const { userId } = await preRegisterMember(deps, {
      accountId,
      email: `a-${randomUUID()}@example.com`,
      name: "감사",
      now: NOW,
    });
    const issued = await issueEnrollmentToken(deps, {
      accountId,
      userId,
      createdBy: adminId,
      now: NOW,
      request,
    });
    const logs = await withTenant(appDb.db, accountId, (tx) =>
      tx
        .select({
          action: schema.auditLog.action,
          diff: schema.auditLog.diff,
          reason: schema.auditLog.reason,
        })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.action, "passkey.enrollment_issue")),
    );
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(issued.token);
  });
});

describe("격리와 권한", () => {
  it("다른 계정의 사용자는 등록 토큰을 볼 수 없다 (RLS)", async () => {
    const a = await makeAccountWithAdmin();
    const b = await makeAccountWithAdmin();
    const { userId } = await preRegisterMember(deps, {
      accountId: a.accountId,
      email: `iso-${randomUUID()}@example.com`,
      name: "격리",
      now: NOW,
    });
    await issueEnrollmentToken(deps, {
      accountId: a.accountId,
      userId,
      createdBy: a.adminId,
      now: NOW,
      request,
    });

    const seenByB = await withTenant(appDb.db, b.accountId, (tx) =>
      tx.select({ id: schema.enrollmentToken.id }).from(schema.enrollmentToken),
    );
    expect(seenByB).toHaveLength(0);
  });

  it("앱 역할은 passkey 표에 직접 접근할 수 없다 (인증 역할 전용)", async () => {
    const error = await appDb.db
      .select()
      .from(schema.passkey)
      .then(
        () => null,
        (e: unknown) => e,
      );
    // drizzle은 드라이버 오류를 감싸므로 원인(cause)까지 본다
    const cause = (error as { cause?: { code?: string } } | null)?.cause;
    expect(cause?.code).toBe("42501");
  });
});

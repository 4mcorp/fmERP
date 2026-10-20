// 사전 등록 사용자와 passkey 등록 토큰 (PK1a). 순수 규칙은 domain/enrollment.ts.
import { createHash, randomBytes } from "node:crypto";
import { type AuditRequestContext, recordAudit } from "@fmerp/audit";
import { type Db, schema, withTenant } from "@fmerp/db";
import { and, eq, isNull } from "drizzle-orm";
import {
  EnrollmentError,
  enrollmentExpiresAt,
  enrollmentTokenState,
  normalizeEnrollmentEmail,
  normalizeEnrollmentName,
} from "../domain/enrollment";

export interface EnrollmentDeps {
  /** fmerp_app 연결 (RLS 적용). 테넌트 표(등록 토큰)를 쓸 때 쓴다 */
  appDb: Db;
  /** fmerp_auth 연결 (RLS 우회). 테넌트가 정해지기 전의 사용자·토큰 확인에 쓴다 */
  authDb: Db;
}

/** 등록 토큰은 원문을 한 번만 보여 주고 DB에는 해시만 둔다 (invitation과 같은 방식) */
function hashEnrollmentToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function createEnrollmentToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashEnrollmentToken(token) };
}

/** 사전 등록을 거부한 이유. 감사 로그 `reason`에만 쓰고 응답에는 싣지 않는다 */
export type PreRegisterRejection = "other_company" | "has_passkey" | "orphan_account";

/**
 * 관리자가 사전 등록한 사람을 만든다: 사용자(없으면) + 이 계정의 구성원 행.
 * 같은 이메일이 이미 있으면 그 사용자를 쓴다. 이 계정에 이미 속해 있으면 아무것도 바꾸지 않고 `joined: false`를 돌려준다
 * (라우트는 409 `member_exists`로 답하고 passkey 초기화를 안내한다).
 * 이 계정에 속하지 않은 기존 사용자(다른 회사 소속, passkey 보유, 소속도 passkey도 없는 고아 계정)는 모두 붙이지 않고
 * `rejected`로 사유를 돌려준다. 라우트는 세 사유를 같은 409 `enrollment_email_unavailable`로 응답한다.
 * 이메일로 남의 계정에 등록 링크를 만들면 그 사람의 계정을 넘겨받게 되므로 허용하지 않는다 (CLAUDE.md: 이메일로 자동 병합 금지).
 * 거부 사유는 `member.pre_register` 감사(result=failure, reason=사유)로 같은 트랜잭션에 남긴다. 응답에는 싣지 않는다.
 * `request`를 주면 구성원 추가·거부 모두 감사를 남긴다.
 */
export async function preRegisterMember(
  deps: EnrollmentDeps,
  input: {
    accountId: string;
    email: string;
    name: string;
    now: Date;
    /** 사전 등록을 한 관리자. request와 함께 주면 감사 행위자가 된다 */
    actorUserId?: string;
    request?: AuditRequestContext;
  },
): Promise<{
  userId: string;
  created: boolean;
  joined: boolean;
  /** 이 계정에 붙이지 않은 사유 (감사 로그용 내부 값). 응답에는 쓰지 않는다 */
  rejected?: PreRegisterRejection;
}> {
  const email = normalizeEnrollmentEmail(input.email);
  const name = normalizeEnrollmentName(input.name);
  const { authDb } = deps;

  return authDb.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email));
    let userId = existing?.id;
    let created = false;
    if (!userId) {
      const [row] = await tx
        .insert(schema.user)
        .values({ name, email, emailVerified: false })
        .returning({ id: schema.user.id });
      if (!row) throw new Error("사용자 생성 결과가 비어 있습니다");
      userId = row.id;
      created = true;
    }

    const [member] = await tx
      .select({ id: schema.membership.id })
      .from(schema.membership)
      .where(
        and(eq(schema.membership.accountId, input.accountId), eq(schema.membership.userId, userId)),
      );
    if (member) return { userId, created, joined: false };

    if (!created) {
      // 두 조회를 항상 함께 돌려 사유에 따라 쿼리 수가 달라지지 않게 한다 (응답은 같아도 시간 차는 남는다: plan 참고)
      const [elsewhere] = await tx
        .select({ id: schema.membership.id })
        .from(schema.membership)
        .where(eq(schema.membership.userId, userId))
        .limit(1);
      const [withPasskey] = await tx
        .select({ id: schema.passkey.id })
        .from(schema.passkey)
        .where(eq(schema.passkey.userId, userId))
        .limit(1);
      const rejected: PreRegisterRejection = elsewhere
        ? "other_company"
        : withPasskey
          ? "has_passkey"
          : "orphan_account";
      if (input.request) {
        await recordAudit(tx, {
          accountId: input.accountId,
          actorUserId: input.actorUserId ?? null,
          action: "member.pre_register",
          target: { type: "user", id: userId },
          subjectUserId: userId,
          result: "failure",
          reason: rejected,
          request: input.request,
        });
      }
      return { userId, created, joined: false, rejected };
    }

    await tx.insert(schema.membership).values({
      accountId: input.accountId,
      userId,
      role: "member",
      status: "active",
      joinedAt: input.now,
    });
    if (input.request) {
      await recordAudit(tx, {
        accountId: input.accountId,
        actorUserId: input.actorUserId ?? null,
        action: "member.pre_register",
        target: { type: "user", id: userId },
        subjectUserId: userId,
        result: "success",
        request: input.request,
      });
    }
    return { userId, created, joined: true };
  });
}

/**
 * 사용자의 등록 토큰을 새로 발급한다. 이전에 발급한 미사용 토큰은 모두 폐기한다 (재발급 시 이전 링크 무효).
 * 감사 로그에 발급 사실을 남긴다 (원문 토큰은 기록하지 않는다).
 */
export async function issueEnrollmentToken(
  deps: EnrollmentDeps,
  input: {
    accountId: string;
    userId: string;
    createdBy: string;
    now: Date;
    request: AuditRequestContext;
    ttlMs?: number;
    /** 감사 행위 이름. 기본은 passkey 초기화와 같은 `passkey.enrollment_issue`다 (PK1d 라우트는 `member.enrollment_issue`) */
    auditAction?: "passkey.enrollment_issue" | "member.enrollment_issue";
  },
): Promise<{ token: string; expiresAt: Date }> {
  const { token, tokenHash } = createEnrollmentToken();
  const expiresAt = enrollmentExpiresAt(input.now, input.ttlMs);

  await withTenant(deps.appDb, input.accountId, async (tx) => {
    await tx
      .update(schema.enrollmentToken)
      .set({ revokedAt: input.now })
      .where(
        and(
          eq(schema.enrollmentToken.userId, input.userId),
          isNull(schema.enrollmentToken.usedAt),
          isNull(schema.enrollmentToken.revokedAt),
        ),
      );
    await tx.insert(schema.enrollmentToken).values({
      accountId: input.accountId,
      userId: input.userId,
      tokenHash,
      expiresAt,
      createdBy: input.createdBy,
    });
    await recordAudit(tx, {
      accountId: input.accountId,
      actorUserId: input.createdBy,
      action: input.auditAction ?? "passkey.enrollment_issue",
      target: { type: "user", id: input.userId },
      subjectUserId: input.userId,
      result: "success",
      request: input.request,
    });
  });
  return { token, expiresAt };
}

type MemberEnrollmentResult =
  | { status: "not_member" }
  | { status: "has_passkey" }
  | { status: "issued"; token: string; expiresAt: Date };

/**
 * 이 계정 구성원에게 등록 링크를 다시 발급한다 (PK1d). passkey가 이미 있으면 발급하지 않는다: 그때는 passkey 초기화를 쓴다.
 * 구성원이 아니면 `not_member`. 권한·재인증은 라우트가 먼저 확인한다.
 */
export async function reissueMemberEnrollment(
  deps: EnrollmentDeps,
  input: {
    accountId: string;
    actorUserId: string;
    targetUserId: string;
    now: Date;
    request: AuditRequestContext;
  },
): Promise<MemberEnrollmentResult> {
  const [member] = await deps.authDb
    .select({ id: schema.membership.id })
    .from(schema.membership)
    .where(
      and(
        eq(schema.membership.accountId, input.accountId),
        eq(schema.membership.userId, input.targetUserId),
      ),
    );
  if (!member) return { status: "not_member" };

  const [withPasskey] = await deps.authDb
    .select({ id: schema.passkey.id })
    .from(schema.passkey)
    .where(eq(schema.passkey.userId, input.targetUserId))
    .limit(1);
  if (withPasskey) return { status: "has_passkey" };

  const issued = await issueEnrollmentToken(deps, {
    accountId: input.accountId,
    userId: input.targetUserId,
    createdBy: input.actorUserId,
    now: input.now,
    request: input.request,
    auditAction: "member.enrollment_issue",
  });
  return { status: "issued", token: issued.token, expiresAt: issued.expiresAt };
}

/**
 * 토큰이 지금 쓸 수 있는지 확인하고 사용자·계정을 돌려준다. 쓸 수 없으면 `enrollment_invalid`.
 * 확인만 하고 사용 처리는 하지 않는다 (passkey 등록이 끝난 뒤 consume으로 처리한다).
 */
export async function verifyEnrollmentToken(
  deps: Pick<EnrollmentDeps, "authDb">,
  input: { token: string; now: Date },
): Promise<{ tokenId: string; userId: string; accountId: string }> {
  const [row] = await deps.authDb
    .select({
      id: schema.enrollmentToken.id,
      userId: schema.enrollmentToken.userId,
      accountId: schema.enrollmentToken.accountId,
      expiresAt: schema.enrollmentToken.expiresAt,
      usedAt: schema.enrollmentToken.usedAt,
      revokedAt: schema.enrollmentToken.revokedAt,
    })
    .from(schema.enrollmentToken)
    .where(eq(schema.enrollmentToken.tokenHash, hashEnrollmentToken(input.token)));
  if (!row || enrollmentTokenState(row, input.now) !== "usable") {
    throw new EnrollmentError("enrollment_invalid", "사용할 수 없는 등록 링크입니다");
  }
  return { tokenId: row.id, userId: row.userId, accountId: row.accountId };
}

/**
 * 토큰을 사용 처리한다. 조건부 UPDATE로 한 번만 성공한다 (동시에 두 번 쓰는 것을 막는다).
 * 이미 쓰였거나 폐기·만료되었으면 `enrollment_invalid`.
 */
export async function consumeEnrollmentToken(
  deps: Pick<EnrollmentDeps, "authDb">,
  input: { tokenId: string; now: Date },
): Promise<void> {
  const [claimed] = await deps.authDb
    .update(schema.enrollmentToken)
    .set({ usedAt: input.now })
    .where(
      and(
        eq(schema.enrollmentToken.id, input.tokenId),
        isNull(schema.enrollmentToken.usedAt),
        isNull(schema.enrollmentToken.revokedAt),
      ),
    )
    .returning({ id: schema.enrollmentToken.id, expiresAt: schema.enrollmentToken.expiresAt });
  if (!claimed || claimed.expiresAt.getTime() <= input.now.getTime()) {
    throw new EnrollmentError("enrollment_invalid", "사용할 수 없는 등록 링크입니다");
  }
}

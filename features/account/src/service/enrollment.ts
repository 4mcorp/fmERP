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

/**
 * 관리자가 사전 등록한 사람을 만든다: 사용자(없으면) + 이 계정의 구성원 행.
 * 같은 이메일이 이미 있으면 그 사용자를 쓴다. 이 계정에 이미 속해 있으면 이름을 바꾸지 않고 그대로 둔다.
 */
export async function preRegisterMember(
  deps: EnrollmentDeps,
  input: { accountId: string; email: string; name: string; now: Date },
): Promise<{ userId: string; created: boolean }> {
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
    if (!member) {
      await tx.insert(schema.membership).values({
        accountId: input.accountId,
        userId,
        role: "member",
        status: "active",
        joinedAt: input.now,
      });
    }
    return { userId, created };
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
      action: "passkey.enrollment_issue",
      target: { type: "user", id: input.userId },
      subjectUserId: input.userId,
      result: "success",
      request: input.request,
    });
  });
  return { token, expiresAt };
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

// 관리자 passkey 초기화 (PK1c). 대상 구성원의 passkey를 모두 지우고 세션을 끊은 뒤 새 등록 토큰을 낸다.
// 권한(계정 관리자)과 PIN 재인증은 라우트가 먼저 확인한다. 이 서비스는 대상이 이 계정 구성원인지만 본다.
import { type AuditRequestContext, recordAudit } from "@fmerp/audit";
import { schema } from "@fmerp/db";
import { and, eq } from "drizzle-orm";
import { type EnrollmentDeps, issueEnrollmentToken } from "./enrollment";

export interface PasskeyResetResult {
  token: string;
  expiresAt: Date;
  removedPasskeys: number;
  endedSessions: number;
}

/**
 * 대상이 이 계정 구성원이 아니면 null을 돌려준다 (라우트는 404로 답해 다른 계정 사용자의 존재를 드러내지 않는다).
 * passkey 삭제·세션 종료·감사 기록은 한 트랜잭션이다. 새 등록 토큰은 그 뒤에 발급하며, 이전 미사용 토큰은 폐기된다.
 */
export async function resetMemberPasskeys(
  deps: EnrollmentDeps,
  input: {
    accountId: string;
    actorUserId: string;
    targetUserId: string;
    now: Date;
    request: AuditRequestContext;
  },
): Promise<PasskeyResetResult | null> {
  const [member] = await deps.authDb
    .select({ id: schema.membership.id })
    .from(schema.membership)
    .where(
      and(
        eq(schema.membership.accountId, input.accountId),
        eq(schema.membership.userId, input.targetUserId),
      ),
    );
  if (!member) return null;

  const counts = await deps.authDb.transaction(async (tx) => {
    const removed = await tx
      .delete(schema.passkey)
      .where(eq(schema.passkey.userId, input.targetUserId))
      .returning({ id: schema.passkey.id });
    const ended = await tx
      .delete(schema.session)
      .where(eq(schema.session.userId, input.targetUserId))
      .returning({ id: schema.session.id });
    await recordAudit(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: "passkey.admin_reset",
      target: { type: "user", id: input.targetUserId },
      subjectUserId: input.targetUserId,
      result: "success",
      reason: `passkey ${removed.length}개 삭제, 세션 ${ended.length}개 종료`,
      request: input.request,
    });
    return { removedPasskeys: removed.length, endedSessions: ended.length };
  });

  const issued = await issueEnrollmentToken(deps, {
    accountId: input.accountId,
    userId: input.targetUserId,
    createdBy: input.actorUserId,
    now: input.now,
    request: input.request,
  });
  return { token: issued.token, expiresAt: issued.expiresAt, ...counts };
}

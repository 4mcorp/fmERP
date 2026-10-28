// 관리자 결재 PIN 초기화. 대상 구성원의 approval_pin 행을 지워 PIN을 미설정 상태로 되돌린다.
// 권한(member.passkey_reset: 소유자·관리자)과 재인증은 라우트가 먼저 확인한다. 이 서비스는 대상이 이 계정 구성원인지만 본다.
import { type AuditRequestContext, recordAudit } from "@fmerp/audit";
import { type Db, schema } from "@fmerp/db";
import { and, eq } from "drizzle-orm";

export interface PinResetResult {
  removed: number;
}

/**
 * 대상이 이 계정 구성원이 아니면 null을 돌려준다 (라우트는 404로 답해 다른 계정 사용자의 존재를 드러내지 않는다).
 * PIN 행 삭제와 감사 기록은 한 트랜잭션이다. 감사 reason에는 삭제 건수만 남기고 PIN 값·해시는 기록하지 않는다.
 */
export async function resetMemberPin(
  deps: { authDb: Db },
  input: {
    accountId: string;
    actorUserId: string;
    targetUserId: string;
    now: Date;
    request: AuditRequestContext;
  },
): Promise<PinResetResult | null> {
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

  return deps.authDb.transaction(async (tx) => {
    const removed = await tx
      .delete(schema.approvalPin)
      .where(eq(schema.approvalPin.userId, input.targetUserId))
      .returning({ userId: schema.approvalPin.userId });
    await recordAudit(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: "pin.admin_reset",
      target: { type: "user", id: input.targetUserId },
      subjectUserId: input.targetUserId,
      result: "success",
      reason: `PIN ${removed.length}개 삭제`,
      request: input.request,
    });
    return { removed: removed.length };
  });
}

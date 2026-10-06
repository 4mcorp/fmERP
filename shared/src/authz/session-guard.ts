import { type AuditRequestContext, recordAudit } from "@fmerp/audit";
import { type Db, schema } from "@fmerp/db";
import { eq } from "drizzle-orm";
import {
  evaluateSession,
  resolveSessionPolicy,
  shouldTouchSession,
} from "../domain/session-policy";
import { AuthDomainError } from "./errors";

export interface ActiveSession {
  sessionId: string;
  userId: string;
  activeAccountId: string | null;
  pinVerifiedAt: Date | null;
}

/**
 * 세션 만료 정책을 적용한다 (PRD AUTH-008).
 * Better Auth는 절대 만료만 지원하므로, 유휴 만료와 계정별 정책은 여기서 판단하고 만료된 세션은 지운다.
 */
export async function enforceSessionPolicy(
  db: Db,
  input: { sessionId: string; now: Date; request: AuditRequestContext },
): Promise<ActiveSession> {
  const [row] = await db
    .select({
      userId: schema.session.userId,
      createdAt: schema.session.createdAt,
      lastActiveAt: schema.session.lastActiveAt,
      activeAccountId: schema.session.activeAccountId,
      pinVerifiedAt: schema.session.pinVerifiedAt,
      securityPolicy: schema.account.securityPolicy,
    })
    .from(schema.session)
    .leftJoin(schema.account, eq(schema.account.id, schema.session.activeAccountId))
    .where(eq(schema.session.id, input.sessionId));

  if (!row) throw new AuthDomainError("unauthenticated", "로그인이 필요합니다");

  const policy = resolveSessionPolicy(row.securityPolicy ?? undefined);
  const state = evaluateSession(
    { createdAt: row.createdAt, lastActiveAt: row.lastActiveAt, now: input.now },
    policy,
  );

  if (state !== "active") {
    await db.delete(schema.session).where(eq(schema.session.id, input.sessionId));
    await recordAudit(db, {
      accountId: row.activeAccountId,
      actorUserId: row.userId,
      action: "auth.session_expired",
      target: { type: "session", id: input.sessionId },
      result: "success",
      reason: state,
      request: input.request,
    });
    throw new AuthDomainError(state, "세션이 만료되었습니다. 다시 로그인하세요");
  }

  if (shouldTouchSession(row.lastActiveAt, input.now)) {
    await db
      .update(schema.session)
      .set({ lastActiveAt: input.now })
      .where(eq(schema.session.id, input.sessionId));
  }

  return {
    sessionId: input.sessionId,
    userId: row.userId,
    activeAccountId: row.activeAccountId,
    pinVerifiedAt: row.pinVerifiedAt,
  };
}

import { type AuditRequestContext, computeAuditDiff, recordAudit } from "@fmerp/audit";
import { type Db, schema } from "@fmerp/db";
import { and, desc, eq, gt, like } from "drizzle-orm";

/** 본인 프로필 (PRD AUTH-016) */
export async function getProfile(db: Db, userId: string) {
  const [row] = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      image: schema.user.image,
      signatureKey: schema.user.signatureKey,
      stampKey: schema.user.stampKey,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return row ?? null;
}

export type ProfilePatch = Partial<{ name: string; signatureKey: string; stampKey: string }>;

export async function updateProfile(
  db: Db,
  input: { userId: string; patch: ProfilePatch; request: AuditRequestContext },
): Promise<void> {
  const before = await getProfile(db, input.userId);
  if (!before) return;
  await db.update(schema.user).set(input.patch).where(eq(schema.user.id, input.userId));
  const diff = computeAuditDiff(
    { name: before.name, signatureKey: before.signatureKey, stampKey: before.stampKey },
    {
      name: input.patch.name ?? before.name,
      signatureKey: input.patch.signatureKey ?? before.signatureKey,
      stampKey: input.patch.stampKey ?? before.stampKey,
    },
  );
  await recordAudit(db, {
    accountId: null,
    actorUserId: input.userId,
    action: "profile.update",
    target: { type: "user", id: input.userId },
    subjectUserId: input.userId,
    diff,
    result: "success",
    request: input.request,
  });
}

/** 본인의 활성 세션 (동시 세션 조회, PRD AUTH-008) */
export function listMySessions(db: Db, userId: string, now: Date) {
  return db
    .select({
      id: schema.session.id,
      ipAddress: schema.session.ipAddress,
      userAgent: schema.session.userAgent,
      createdAt: schema.session.createdAt,
      lastActiveAt: schema.session.lastActiveAt,
    })
    .from(schema.session)
    .where(and(eq(schema.session.userId, userId), gt(schema.session.expiresAt, now)))
    .orderBy(desc(schema.session.lastActiveAt));
}

/** 본인 세션 강제 종료 (PRD AUTH-008) */
export async function revokeMySession(
  db: Db,
  input: { userId: string; sessionId: string; request: AuditRequestContext },
): Promise<boolean> {
  const deleted = await db
    .delete(schema.session)
    .where(and(eq(schema.session.id, input.sessionId), eq(schema.session.userId, input.userId)))
    .returning({ id: schema.session.id });
  if (deleted.length === 0) return false;
  await recordAudit(db, {
    accountId: null,
    actorUserId: input.userId,
    action: "session.revoke",
    target: { type: "session", id: input.sessionId },
    result: "success",
    request: input.request,
  });
  return true;
}

/** 본인 로그인 이력 (PRD AUTH-013) */
export function listLoginHistory(db: Db, userId: string, limit = 50) {
  return db
    .select({
      occurredAt: schema.auditLog.occurredAt,
      action: schema.auditLog.action,
      result: schema.auditLog.result,
      ip: schema.auditLog.ip,
      userAgent: schema.auditLog.userAgent,
      reason: schema.auditLog.reason,
    })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.actorUserId, userId), like(schema.auditLog.action, "auth.%")))
    .orderBy(desc(schema.auditLog.occurredAt))
    .limit(limit);
}

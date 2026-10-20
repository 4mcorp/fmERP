// 내 패스키 목록·이름 변경·삭제 (PK1b). 모든 작업은 본인 패스키로 한정하고 감사를 남긴다.
// 마지막 1개는 지울 수 없다 (domain/passkey.ts). 플러그인의 같은 경로는 disabledPaths로 막는다.
import { type AuditRequestContext, recordAudit } from "@fmerp/audit";
import { type Db, schema } from "@fmerp/db";
import { and, eq } from "drizzle-orm";
import { canDeletePasskey } from "../domain/passkey";

export async function listPasskeys(authDb: Db, userId: string) {
  const rows = await authDb
    .select({
      id: schema.passkey.id,
      name: schema.passkey.name,
      deviceType: schema.passkey.deviceType,
      backedUp: schema.passkey.backedUp,
      createdAt: schema.passkey.createdAt,
    })
    .from(schema.passkey)
    .where(eq(schema.passkey.userId, userId))
    .orderBy(schema.passkey.createdAt);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt?.toISOString() ?? null }));
}

/** 본인 패스키가 아니면 false (다른 사용자의 id에는 아무 일도 일어나지 않는다) */
export async function renamePasskey(
  authDb: Db,
  input: { userId: string; passkeyId: string; name: string; request: AuditRequestContext },
): Promise<boolean> {
  return authDb.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.passkey)
      .set({ name: input.name })
      .where(and(eq(schema.passkey.id, input.passkeyId), eq(schema.passkey.userId, input.userId)))
      .returning({ id: schema.passkey.id });
    if (!row) return false;
    await recordAudit(tx, {
      accountId: null,
      actorUserId: input.userId,
      action: "passkey.rename",
      target: { type: "passkey", id: input.passkeyId },
      subjectUserId: input.userId,
      result: "success",
      request: input.request,
    });
    return true;
  });
}

export async function deletePasskey(
  authDb: Db,
  input: { userId: string; passkeyId: string; request: AuditRequestContext },
): Promise<"deleted" | "not_found" | "last"> {
  return authDb.transaction(async (tx) => {
    // 같은 사용자의 삭제가 동시에 일어나도 마지막 1개가 남도록 본인 패스키 행을 잠근 뒤 센다
    const owned = await tx
      .select({ id: schema.passkey.id })
      .from(schema.passkey)
      .where(eq(schema.passkey.userId, input.userId))
      .for("update");
    if (!owned.some((r) => r.id === input.passkeyId)) return "not_found";
    if (!canDeletePasskey(owned.length)) return "last";
    await tx
      .delete(schema.passkey)
      .where(and(eq(schema.passkey.id, input.passkeyId), eq(schema.passkey.userId, input.userId)));
    await recordAudit(tx, {
      accountId: null,
      actorUserId: input.userId,
      action: "passkey.delete",
      target: { type: "passkey", id: input.passkeyId },
      subjectUserId: input.userId,
      result: "success",
      request: input.request,
    });
    return "deleted";
  });
}

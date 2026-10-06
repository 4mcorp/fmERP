import { type AuditRequestContext, recordAudit } from "@fmerp/audit";
import { isPinFormatValid, pinLockState, recordPinFailure } from "@fmerp/core";
import { type Db, schema } from "@fmerp/db";
import { hash, verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { AuthDomainError } from "./errors";

/** 결재 PIN을 설정·변경한다. 이미 있으면 현재 PIN을 확인한다 (PRD AUTH-009). */
export async function setApprovalPin(
  db: Db,
  input: {
    userId: string;
    pin: string;
    currentPin?: string;
    now: Date;
    request: AuditRequestContext;
  },
): Promise<void> {
  if (!isPinFormatValid(input.pin)) {
    throw new AuthDomainError("pin_format", "PIN은 숫자 6~12자리여야 합니다");
  }
  const [existing] = await db
    .select()
    .from(schema.approvalPin)
    .where(eq(schema.approvalPin.userId, input.userId));

  if (existing) {
    if (!input.currentPin) {
      throw new AuthDomainError("pin_current_required", "현재 PIN을 입력하세요");
    }
    await checkPin(db, existing, input.currentPin, input);
  }

  // @node-rs/argon2의 기본 알고리즘은 Argon2id
  const pinHash = await hash(input.pin);
  await db
    .insert(schema.approvalPin)
    .values({ userId: input.userId, pinHash })
    .onConflictDoUpdate({
      target: schema.approvalPin.userId,
      set: { pinHash, failedCount: 0, lockedUntil: null },
    });
  await recordAudit(db, {
    accountId: null,
    actorUserId: input.userId,
    action: existing ? "pin.change" : "pin.set",
    target: { type: "user", id: input.userId },
    result: "success",
    request: input.request,
  });
}

/** 결재 PIN을 확인하고, 성공하면 세션에 재인증 시각을 남긴다 (30분 동안 다시 묻지 않음). */
export async function verifyApprovalPin(
  db: Db,
  input: {
    userId: string;
    sessionId: string;
    pin: string;
    now: Date;
    request: AuditRequestContext;
  },
): Promise<void> {
  const [record] = await db
    .select()
    .from(schema.approvalPin)
    .where(eq(schema.approvalPin.userId, input.userId));
  if (!record) throw new AuthDomainError("pin_not_set", "결재 PIN을 먼저 설정하세요");

  await checkPin(db, record, input.pin, input);
  await db
    .update(schema.session)
    .set({ pinVerifiedAt: input.now })
    .where(eq(schema.session.id, input.sessionId));
}

async function checkPin(
  db: Db,
  record: typeof schema.approvalPin.$inferSelect,
  pin: string,
  input: { userId: string; now: Date; request: AuditRequestContext },
): Promise<void> {
  const lock = pinLockState(record, input.now);
  if (lock.locked) {
    throw new AuthDomainError("pin_locked", "PIN 입력이 잠겼습니다", {
      remainingSeconds: lock.remainingSeconds,
    });
  }

  if (await verify(record.pinHash, pin)) {
    if (record.failedCount > 0 || record.lockedUntil) {
      await db
        .update(schema.approvalPin)
        .set({ failedCount: 0, lockedUntil: null })
        .where(eq(schema.approvalPin.userId, input.userId));
    }
    return;
  }

  const next = recordPinFailure(record, input.now);
  await db.update(schema.approvalPin).set(next).where(eq(schema.approvalPin.userId, input.userId));
  const locked = next.lockedUntil !== null && next.lockedUntil.getTime() > input.now.getTime();
  await recordAudit(db, {
    accountId: null,
    actorUserId: input.userId,
    action: locked ? "pin.locked" : "pin.verify",
    target: { type: "user", id: input.userId },
    result: "failure",
    reason: locked ? "5회 실패로 15분 잠금" : "PIN 불일치",
    request: input.request,
  });
  if (locked) {
    throw new AuthDomainError("pin_locked", "PIN을 5회 틀려 15분 동안 잠겼습니다", {
      remainingSeconds: Math.ceil(
        ((next.lockedUntil?.getTime() ?? 0) - input.now.getTime()) / 1000,
      ),
    });
  }
  throw new AuthDomainError("pin_mismatch", "PIN이 일치하지 않습니다");
}

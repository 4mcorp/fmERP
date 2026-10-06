// PIN 재인증 판정 (AUTH-009, APV-043). 결재·백업·완료 패키지·알림이 같은 이유로 쓰는 공통 규칙이다.
import { isPinReauthFresh } from "@fmerp/core";
import { type Db, schema, withTenant } from "@fmerp/db";
import { eq } from "drizzle-orm";
import type { ServerDeps } from "../server/deps";
import { ApiError, type DepsProvider } from "../server/http";

export async function hasApprovalPin(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: schema.approvalPin.userId })
    .from(schema.approvalPin)
    .where(eq(schema.approvalPin.userId, userId));
  return Boolean(row);
}

type ReauthSession = { userId: string; pinVerifiedAt: Date | null };

async function assertPinFresh(d: ServerDeps, session: ReauthSession): Promise<void> {
  if (!(await hasApprovalPin(d.authDb, session.userId))) {
    throw new ApiError(428, "pin_not_set", "결재 PIN을 먼저 설정하세요");
  }
  if (!isPinReauthFresh(session.pinVerifiedAt, d.now())) {
    throw new ApiError(428, "reauth_required", "결재 PIN을 입력하세요");
  }
}

/** 항상 PIN 재인증을 요구한다 (계정 정책으로 면제할 수 없다. 시스템 덤프 등) */
export const requireStrictReauth = assertPinFresh;

/**
 * 결재 처리 재인증: 세션의 PIN 확인 시각이 30분 안이어야 한다.
 * 계정 정책 `pinRequired=false`이면 생략한다. PIN이 없으면 먼저 설정하도록 안내한다.
 */
export function createRequireReauth(deps: DepsProvider) {
  return async function requireReauth(accountId: string, session: ReauthSession) {
    const d = deps();
    const [account] = await withTenant(d.appDb, accountId, (tx) =>
      tx.select({ policy: schema.account.securityPolicy }).from(schema.account),
    );
    if (account?.policy.pinRequired === false) return;
    await assertPinFresh(d, session);
  };
}

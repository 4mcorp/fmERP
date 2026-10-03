import { hasApprovalPin } from "@fmerp/auth";
import { isPinReauthFresh } from "@fmerp/core";
import { schema, withTenant } from "@fmerp/db";
import { ApiError, type DepsProvider } from "../http";

/**
 * 결재 처리 재인증 (AUTH-009, APV-043): 세션의 PIN 확인 시각이 30분 안이어야 한다.
 * 계정 정책 `pinRequired=false`이면 생략한다. PIN이 없으면 먼저 설정하도록 안내한다.
 */
export function createRequireReauth(deps: DepsProvider) {
  return async function requireReauth(
    accountId: string,
    session: { userId: string; pinVerifiedAt: Date | null },
  ) {
    const d = deps();
    const [account] = await withTenant(d.appDb, accountId, (tx) =>
      tx.select({ policy: schema.account.securityPolicy }).from(schema.account),
    );
    if (account?.policy.pinRequired === false) return;
    if (!(await hasApprovalPin(d.authDb, session.userId))) {
      throw new ApiError(428, "pin_not_set", "결재 PIN을 먼저 설정하세요");
    }
    if (!isPinReauthFresh(session.pinVerifiedAt, d.now())) {
      throw new ApiError(428, "reauth_required", "결재 PIN을 입력하세요");
    }
  };
}

// passkey(WebAuthn) 등록·로그인 연결 (PK1b). createAuth의 passkey 플러그인 설정이 쓴다.
// 순수 규칙은 domain/passkey.ts, 목록·이름 변경·삭제는 passkey-manage.ts. 등록 링크(토큰)의 검증·사용 처리는 enrollment.ts가 맡는다.
import { type AuditRequestContext, recordAudit } from "@fmerp/audit";
import { type Db, schema } from "@fmerp/db";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { EnrollmentError } from "../domain/enrollment";
import { consumeEnrollmentToken, verifyEnrollmentToken } from "./enrollment";

export interface PasskeyServiceDeps {
  /** fmerp_auth 연결 (passkey·등록 토큰·사용자 표) */
  authDb: Db;
}

/** 등록 실패 사유를 구분하지 않는다. 링크가 틀린 것인지 쓴 것인지 드러내지 않는다 (사용자 열거 방지) */
const INVALID_ENROLLMENT = "사용할 수 없는 등록 링크입니다";

async function usableToken(deps: PasskeyServiceDeps, token: string, now: Date) {
  try {
    return await verifyEnrollmentToken(deps, { token, now });
  } catch (e) {
    if (e instanceof EnrollmentError) {
      throw new APIError("BAD_REQUEST", { message: INVALID_ENROLLMENT });
    }
    throw e;
  }
}

/**
 * 세션이 없을 때 등록 대상 사용자를 정한다. 등록 토큰 해시가 없거나 쓸 수 없으면 거부한다.
 * (로그인한 사용자의 추가 등록은 플러그인이 세션으로 먼저 정하므로 여기까지 오지 않는다)
 */
export async function resolveEnrollmentUser(
  deps: PasskeyServiceDeps,
  input: { token: string | null; now: Date },
): Promise<{ id: string; name: string; displayName: string }> {
  if (!input.token) {
    throw new APIError("UNAUTHORIZED", { message: "로그인하거나 등록 링크가 필요합니다" });
  }
  const row = await usableToken(deps, input.token, input.now);
  const [user] = await deps.authDb
    .select({ name: schema.user.name, email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, row.userId));
  if (!user) throw new APIError("BAD_REQUEST", { message: INVALID_ENROLLMENT });
  return { id: row.userId, name: user.email, displayName: user.name };
}

/**
 * 등록이 검증된 뒤 호출된다. 등록 토큰으로 시작한 등록이면 토큰을 사용 처리하고 감사를 남긴다.
 * 로그인 상태의 추가 등록이면 감사만 남긴다.
 * 알려진 한계: 토큰은 이 시점에 사용 처리되고 passkey 행은 뒤에 저장된다. 저장이 실패하면 링크는 다시 쓸 수 없다.
 */
export async function afterPasskeyRegistered(
  deps: PasskeyServiceDeps,
  input: { userId: string; token: string | null; now: Date; request: AuditRequestContext },
): Promise<void> {
  const target = { type: "user", id: input.userId };
  if (!input.token) {
    await recordAudit(deps.authDb, {
      accountId: null,
      actorUserId: input.userId,
      action: "passkey.register",
      target,
      subjectUserId: input.userId,
      result: "success",
      request: input.request,
    });
    return;
  }
  const row = await usableToken(deps, input.token, input.now);
  if (row.userId !== input.userId) {
    throw new APIError("BAD_REQUEST", { message: INVALID_ENROLLMENT });
  }
  try {
    await consumeEnrollmentToken(deps, { tokenId: row.tokenId, now: input.now });
  } catch (e) {
    if (e instanceof EnrollmentError) {
      throw new APIError("BAD_REQUEST", { message: INVALID_ENROLLMENT });
    }
    throw e;
  }
  await recordAudit(deps.authDb, {
    accountId: row.accountId,
    actorUserId: input.userId,
    action: "passkey.enroll",
    target,
    subjectUserId: input.userId,
    result: "success",
    request: input.request,
  });
}

/** 플러그인 훅에 넘길 요청 출처 (접속 IP는 신뢰하는 헤더만 쓴다, 보안 리뷰 SR-1) */
export function auditRequestOf(
  headers: Headers | undefined,
  ipHeaders: readonly string[],
): AuditRequestContext {
  const ip = ipHeaders.map((h) => headers?.get(h) ?? null).find((v) => v) ?? null;
  return { ip, userAgent: headers?.get("user-agent") ?? null, requestId: null };
}

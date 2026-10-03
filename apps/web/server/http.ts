import { randomUUID } from "node:crypto";
import type { AuditRequestContext } from "@fmerp/audit";
import {
  type ActiveSession,
  AuthDomainError,
  type AuthErrorCode,
  enforceSessionPolicy,
  requireActiveMembership,
} from "@fmerp/auth";
import type { MembershipRole } from "@fmerp/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import type { ServerDeps } from "./deps";
import { problem } from "./problem";

export interface AppEnv {
  Variables: {
    request: AuditRequestContext;
    session: ActiveSession;
    tenant: { accountId: string; role: MembershipRole };
  };
}

export type AppRouter = OpenAPIHono<AppEnv>;
export type DepsProvider = () => ServerDeps;

/** 업무 규칙 위반 등 API 계층에서 바로 응답할 오류 */
export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 423,
    readonly code: string,
    message: string,
    /** 응답 본문(`extensions`)에 실을 부가 정보 (예: 뎁스를 넘는 부서 목록) */
    readonly extensions?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const AUTH_ERROR_STATUS: Record<AuthErrorCode, 400 | 401 | 403 | 409 | 423> = {
  unauthenticated: 401,
  idle_expired: 401,
  absolute_expired: 401,
  no_active_account: 403,
  membership_inactive: 403,
  invitation_invalid: 400,
  already_member: 409,
  pin_format: 400,
  pin_not_set: 400,
  pin_current_required: 400,
  pin_mismatch: 400,
  pin_locked: 423,
};

/** 도메인 오류를 RFC 9457 응답으로 바꾼다. 처리할 수 없으면 null (ADR 0003) */
export function toProblemResponse(error: unknown): Response | null {
  if (error instanceof AuthDomainError) {
    const remaining = error.details?.remainingSeconds;
    return problem(
      AUTH_ERROR_STATUS[error.code],
      error.code,
      error.message,
      typeof remaining === "number" ? `${remaining}초 후 다시 시도하세요` : undefined,
    );
  }
  if (error instanceof ApiError) {
    return problem(error.status, error.code, error.message, undefined, error.extensions);
  }
  return dbConstraintProblem(error);
}

/**
 * DB가 막은 규칙 위반(트리거 CHECK·유일성·참조)을 업무 오류로 바꾼다. 규칙은 먼저 core·API에서 검사하고,
 * 이 변환은 마지막 방어선이 막았을 때 사용자에게 이유를 보여 주기 위한 것이다.
 */
function dbConstraintProblem(error: unknown): Response | null {
  const cause = (error as { cause?: { code?: string; message?: string } } | null)?.cause;
  switch (cause?.code) {
    case "23514":
      return problem(400, "validation_error", cause.message ?? "허용되지 않는 값입니다");
    case "23505":
      return problem(409, "duplicate", "이미 사용 중인 값입니다");
    case "23503":
      return problem(409, "in_use", "다른 데이터가 사용 중이어서 처리할 수 없습니다");
    default:
      return null;
  }
}

/**
 * 감사 로그의 접속지로 믿을 수 있는 헤더 (PRD AUD-021).
 * 운영은 Cloudflare Tunnel 뒤에서만 접근되고 Cloudflare가 CF-Connecting-IP를 덮어쓰므로 그 헤더만 믿는다.
 * X-Forwarded-For는 클라이언트가 임의로 넣을 수 있어 개발·테스트에서만 쓴다 (보안 리뷰 SR-1).
 */
export function trustedIpHeaders(nodeEnv: string | undefined): string[] {
  return nodeEnv === "production" ? ["cf-connecting-ip"] : ["cf-connecting-ip", "x-forwarded-for"];
}

const MAX_HEADER_VALUE = 200;
const clip = (value: string | undefined) => value?.slice(0, MAX_HEADER_VALUE);

/** 요청 ID와 접속지 정보 (감사 로그 필수 항목, PRD AUD-021) */
export const requestContext = createMiddleware<AppEnv>(async (c, next) => {
  const ip = trustedIpHeaders(process.env.NODE_ENV)
    .map((h) => c.req.header(h)?.split(",")[0]?.trim())
    .find(Boolean);
  c.set("request", {
    requestId: clip(c.req.header("x-request-id")) ?? randomUUID(),
    ip: clip(ip) ?? null,
    userAgent: clip(c.req.header("user-agent")) ?? null,
  });
  await next();
});

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF 이중 방어: 상태를 바꾸는 요청에 다른 출처의 Origin이 붙어 있으면 거부한다 (보안 리뷰 SR-2).
 * 1차 방어는 SameSite 쿠키와 JSON 전용 API(교차 출처 JSON 요청은 사전 요청에서 막힘)이다.
 * Origin이 없는 요청(서버 간 호출 등)은 브라우저 쿠키를 싣지 않으므로 통과시킨다.
 */
export const requireSameOrigin = (allowedOrigin: () => string) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const origin = c.req.header("origin");
    if (UNSAFE_METHODS.has(c.req.method) && origin && origin !== allowedOrigin()) {
      throw new ApiError(403, "forbidden_origin", "허용되지 않은 출처의 요청입니다");
    }
    await next();
  });

/** 로그인 세션 확인 + 유휴·절대 만료 정책 적용 (PRD AUTH-008) */
export const requireSession = (deps: DepsProvider) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const { auth, authDb, now } = deps();
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!result) throw new AuthDomainError("unauthenticated", "로그인이 필요합니다");
    const session = await enforceSessionPolicy(authDb, {
      sessionId: result.session.id,
      now: now(),
      request: c.get("request"),
    });
    c.set("session", session);
    await next();
  });

/** 활성 계정의 재직 구성원만 통과시키고 테넌트를 정한다 (PRD PERM-002, AUTH-015) */
export const requireTenant = (deps: DepsProvider) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const session = c.get("session");
    if (!session.activeAccountId) {
      throw new AuthDomainError("no_active_account", "회사를 먼저 선택하세요");
    }
    const { role } = await requireActiveMembership(
      deps().authDb,
      session.activeAccountId,
      session.userId,
    );
    c.set("tenant", { accountId: session.activeAccountId, role });
    await next();
  });

export function requireRole(...roles: MembershipRole[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!roles.includes(c.get("tenant").role)) {
      throw new ApiError(403, "forbidden", "권한이 없습니다");
    }
    await next();
  });
}

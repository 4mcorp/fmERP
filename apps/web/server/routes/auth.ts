import { recordAudit } from "@fmerp/audit";
import { DEV_TEST_PASSWORD, listMyAccounts, TEST_USERS } from "@fmerp/auth";
import { schema } from "@fmerp/db";
import { createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { ServerDeps } from "../deps";
import { ApiError, type AppRouter, type DepsProvider } from "../http";
import { errorResponses, json } from "./common";

type LoginResult = { token?: string; user?: { id?: string } };

/**
 * 로그인 성공 후 처리: 재직 중인 회사가 있으면 첫 회사를 활성 계정으로 정하고, 로그인 기록을 남긴다 (PRD AUTH-013).
 */
async function afterLogin(
  deps: ServerDeps,
  result: LoginResult,
  request: Parameters<typeof recordAudit>[1]["request"],
) {
  const userId = result.user?.id;
  if (!userId || !result.token) return;
  const accounts = (await listMyAccounts(deps.authDb, userId)).filter((a) => a.status === "active");
  const first = accounts[0];
  if (first) {
    await deps.authDb
      .update(schema.session)
      .set({ activeAccountId: first.accountId })
      .where(eq(schema.session.token, result.token));
  }
  await recordAudit(deps.authDb, {
    accountId: first?.accountId ?? null,
    actorUserId: userId,
    action: "auth.login",
    target: { type: "user", id: userId },
    result: "success",
    request,
  });
}

async function recordLoginFailure(
  deps: ServerDeps,
  email: unknown,
  request: Parameters<typeof recordAudit>[1]["request"],
) {
  await recordAudit(deps.authDb, {
    accountId: null,
    actorUserId: null,
    action: "auth.login",
    // 입력값이라 길이를 제한해 기록한다 (보안 리뷰 SR-4)
    target: {
      type: "login",
      id: "email",
      label: typeof email === "string" ? email.slice(0, 254) : undefined,
    },
    result: "failure",
    reason: "로그인 정보 불일치",
    request,
  });
}

export function registerAuthRoutes(app: AppRouter, deps: DepsProvider) {
  // Better Auth 핸들러. 로그인·로그아웃은 감사 로그를 남긴다 (PRD AUD-020)
  app.on(["GET", "POST"], "/auth/*", async (c) => {
    const d = deps();
    const request = c.get("request");
    const path = new URL(c.req.url).pathname.replace(/^\/api\/auth/, "");

    if (c.req.method === "POST" && path === "/sign-in/email") {
      const body = (await c.req.raw
        .clone()
        .json()
        .catch(() => ({}))) as { email?: unknown };
      const res = await d.auth.handler(c.req.raw);
      if (res.ok) await afterLogin(d, (await res.clone().json()) as LoginResult, request);
      else await recordLoginFailure(d, body.email, request);
      return res;
    }

    if (c.req.method === "POST" && path === "/sign-out") {
      const before = await d.auth.api.getSession({ headers: c.req.raw.headers });
      const res = await d.auth.handler(c.req.raw);
      if (res.ok && before) {
        await recordAudit(d.authDb, {
          accountId: before.session.activeOrganizationId ?? null,
          actorUserId: before.user.id,
          action: "auth.logout",
          target: { type: "session", id: before.session.id },
          result: "success",
          request,
        });
      }
      return res;
    }

    return d.auth.handler(c.req.raw);
  });

  // ===== 개발용 테스트 로그인 (M1 계획 1장). 꺼져 있으면 404 =====
  const devOnly = () => {
    if (!deps().devTestLogin) throw new ApiError(404, "not_found", "요청한 경로가 없습니다");
  };

  const TestUserSchema = z
    .object({
      email: z.string(),
      name: z.string(),
      purpose: z.string(),
      memberships: z.array(z.object({ account: z.string(), role: z.string() })),
    })
    .openapi("DevTestUser");

  app.openapi(
    createRoute({
      method: "get",
      path: "/dev/test-accounts",
      tags: ["dev"],
      summary: "테스트 계정 목록 (개발·테스트 전용)",
      responses: { 200: json(z.array(TestUserSchema)), ...errorResponses },
    }),
    (c) => {
      devOnly();
      return c.json(
        TEST_USERS.map((u) => ({
          email: u.email,
          name: u.name,
          purpose: u.purpose,
          memberships: u.memberships.map((m) => ({ account: m.account, role: m.role })),
        })),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/dev/login",
      tags: ["dev"],
      summary: "테스트 계정으로 로그인 (개발·테스트 전용)",
      request: {
        body: { content: { "application/json": { schema: z.object({ email: z.email() }) } } },
      },
      responses: { 200: json(z.object({ ok: z.literal(true) })), ...errorResponses },
    }),
    async (c) => {
      devOnly();
      const { email } = c.req.valid("json");
      if (!TEST_USERS.some((u) => u.email === email)) {
        throw new ApiError(400, "validation_error", "시드에 없는 테스트 계정입니다");
      }
      const d = deps();
      const res = await d.auth.api.signInEmail({
        body: { email, password: DEV_TEST_PASSWORD },
        headers: c.req.raw.headers,
        asResponse: true,
      });
      if (!res.ok) {
        await recordLoginFailure(d, email, c.get("request"));
        throw new ApiError(
          401,
          "unauthenticated",
          "테스트 계정 로그인에 실패했습니다. pnpm db:seed를 확인하세요",
        );
      }
      await afterLogin(d, (await res.clone().json()) as LoginResult, c.get("request"));
      const out = c.json({ ok: true as const }, 200);
      for (const cookie of res.headers.getSetCookie()) out.headers.append("set-cookie", cookie);
      return out;
    },
  );
}

import { requireStrictReauth } from "@fmerp/shared/authz/reauth";
import { errorResponses, json, OkSchema } from "@fmerp/shared/server/common";
import { type AppRouter, type DepsProvider, requireTenant } from "@fmerp/shared/server/http";
import { createRoute, z } from "@hono/zod-openapi";
import { AgentTokenInputSchema, AgentTokenSummarySchema } from "../agent-token-schema";
import { issueAgentToken, listAgentTokens, revokeAgentToken } from "../service/agent-token";

export function registerAgentTokenRoutes(app: AppRouter, deps: DepsProvider) {
  app.use("/me/agent-tokens", requireTenant(deps));
  app.use("/me/agent-tokens/*", requireTenant(deps));
  app.use("/me/agent-tokens", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use("/me/agent-tokens/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.openapi(
    createRoute({
      method: "post",
      path: "/me/agent-tokens",
      tags: ["me"],
      summary: "개인 에이전트 토큰 발급",
      request: { body: { content: { "application/json": { schema: AgentTokenInputSchema } } } },
      responses: {
        201: json(z.object({ id: z.uuid(), token: z.string(), expiresAt: z.string() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const session = c.get("session");
      await requireStrictReauth(d, session);
      const result = await issueAgentToken(
        d.appDb,
        { accountId: c.get("tenant").accountId, userId: session.userId, request: c.get("request") },
        c.req.valid("json"),
        d.now(),
      );
      return c.json(result, 201);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/me/agent-tokens",
      tags: ["me"],
      summary: "본인 에이전트 토큰 목록",
      responses: { 200: json(z.array(AgentTokenSummarySchema)), ...errorResponses },
    }),
    async (c) =>
      c.json(
        await listAgentTokens(deps().appDb, {
          accountId: c.get("tenant").accountId,
          userId: c.get("session").userId,
        }),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "delete",
      path: "/me/agent-tokens/{id}",
      tags: ["me"],
      summary: "본인 에이전트 토큰 폐기",
      request: { params: z.object({ id: z.uuid() }) },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      await revokeAgentToken(
        deps().appDb,
        {
          accountId: c.get("tenant").accountId,
          userId: c.get("session").userId,
          request: c.get("request"),
        },
        c.req.valid("param").id,
        deps().now(),
      );
      return c.json({ ok: true as const }, 200);
    },
  );
}

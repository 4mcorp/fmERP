import {
  acceptInvitation,
  createAccount,
  previewInvitation,
  switchActiveAccount,
} from "@fmerp/auth";
import { DEFAULT_POSITIONS } from "@fmerp/core";
import { schema, withTenant } from "@fmerp/db";
import { createRoute, z } from "@hono/zod-openapi";
import { ApiError, type AppRouter, type DepsProvider, requireSession } from "../http";
import { errorResponses, json, OkSchema } from "./common";

/** 회사(계정) 만들기·전환, 초대 수락. 활성 계정이 없어도 쓸 수 있다 (PRD AUTH-005·006·007) */
export function registerAccountsRoutes(app: AppRouter, deps: DepsProvider) {
  app.use("/accounts", requireSession(deps));
  app.use("/accounts/*", requireSession(deps));
  app.use("/invitations/*", requireSession(deps));

  app.openapi(
    createRoute({
      method: "post",
      path: "/accounts",
      tags: ["accounts"],
      summary: "새 회사(계정) 만들기 — 만든 사람이 소유자 (AUTH-005 ①)",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({ name: z.string().trim().min(2).max(100) }),
            },
          },
        },
      },
      responses: {
        201: json(z.object({ accountId: z.string(), name: z.string() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const session = c.get("session");
      const created = await createAccount(
        { db: d.authDb, auth: d.auth },
        {
          userId: session.userId,
          sessionId: session.sessionId,
          name: c.req.valid("json").name,
          request: c.get("request"),
        },
      );
      // 직위 마스터 기본값 (ORG-030). 첫 사업자 등록은 온보딩 화면이 안내한다 (ORG-002)
      await withTenant(d.appDb, created.accountId, (tx) =>
        tx
          .insert(schema.position)
          .values(DEFAULT_POSITIONS.map((p) => ({ accountId: created.accountId, ...p }))),
      );
      return c.json(created, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/accounts/active",
      tags: ["accounts"],
      summary: "활성 회사 전환 (AUTH-007)",
      request: {
        body: { content: { "application/json": { schema: z.object({ accountId: z.uuid() }) } } },
      },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const session = c.get("session");
      await switchActiveAccount(deps().authDb, {
        sessionId: session.sessionId,
        userId: session.userId,
        accountId: c.req.valid("json").accountId,
        request: c.get("request"),
      });
      return c.json({ ok: true as const }, 200);
    },
  );

  const tokenSchema = z.string().min(20).max(200);

  app.openapi(
    createRoute({
      method: "get",
      path: "/invitations/{token}",
      tags: ["invitations"],
      summary: "초대 내용 확인",
      request: { params: z.object({ token: tokenSchema }) },
      responses: {
        200: json(z.object({ accountName: z.string(), role: z.string() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const preview = await previewInvitation(d.authDb, c.req.valid("param").token, d.now());
      if (!preview) {
        throw new ApiError(400, "invitation_invalid", "만료되었거나 이미 사용된 초대입니다");
      }
      return c.json(preview, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/invitations/accept",
      tags: ["invitations"],
      summary: "초대 수락 (AUTH-005 ②, AUTH-006)",
      request: {
        body: { content: { "application/json": { schema: z.object({ token: tokenSchema }) } } },
      },
      responses: { 200: json(z.object({ accountId: z.string() })), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const session = c.get("session");
      const result = await acceptInvitation(
        { db: d.authDb, auth: d.auth },
        {
          token: c.req.valid("json").token,
          userId: session.userId,
          sessionId: session.sessionId,
          now: d.now(),
          request: c.get("request"),
        },
      );
      return c.json(result, 200);
    },
  );
}

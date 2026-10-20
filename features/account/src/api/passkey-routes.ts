import { errorResponses, json, OkSchema } from "@fmerp/shared/server/common";
import { ApiError, type AppRouter, type DepsProvider } from "@fmerp/shared/server/http";
import { createRoute, z } from "@hono/zod-openapi";
import { deletePasskey, listPasskeys, renamePasskey } from "../service/passkey-manage";

const PasskeySchema = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    deviceType: z.string(),
    backedUp: z.boolean(),
    createdAt: z.string().nullable(),
  })
  .openapi("Passkey");

const PasskeyParams = z.object({ id: z.uuid() });

/** 내 패스키 목록·이름 변경·삭제 (PK1b). /me/* 세션 가드는 registerMeRoutes가 건다 */
export function registerPasskeyRoutes(app: AppRouter, deps: DepsProvider) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/me/passkeys",
      tags: ["me"],
      summary: "내 패스키 목록",
      responses: { 200: json(z.array(PasskeySchema)), ...errorResponses },
    }),
    async (c) => {
      const rows = await listPasskeys(deps().authDb, c.get("session").userId);
      return c.json(rows, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/me/passkeys/{id}",
      tags: ["me"],
      summary: "패스키 이름 변경",
      request: {
        params: PasskeyParams,
        body: {
          content: {
            "application/json": { schema: z.object({ name: z.string().trim().min(1).max(100) }) },
          },
        },
      },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const updated = await renamePasskey(deps().authDb, {
        userId: c.get("session").userId,
        passkeyId: c.req.valid("param").id,
        name: c.req.valid("json").name,
        request: c.get("request"),
      });
      if (!updated) throw new ApiError(404, "not_found", "패스키가 없습니다");
      return c.json({ ok: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/me/passkeys/{id}",
      tags: ["me"],
      summary: "패스키 삭제 (마지막 1개는 삭제할 수 없다)",
      request: { params: PasskeyParams },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const result = await deletePasskey(deps().authDb, {
        userId: c.get("session").userId,
        passkeyId: c.req.valid("param").id,
        request: c.get("request"),
      });
      if (result === "not_found") throw new ApiError(404, "not_found", "패스키가 없습니다");
      if (result === "last") {
        throw new ApiError(
          409,
          "last_passkey",
          "마지막 패스키는 지울 수 없습니다. 다른 패스키를 먼저 등록하세요",
        );
      }
      return c.json({ ok: true as const }, 200);
    },
  );
}

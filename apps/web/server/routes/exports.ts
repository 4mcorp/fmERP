import { errorResponses, json } from "@fmerp/shared/server/common";
import {
  type AppRouter,
  type DepsProvider,
  requireSession,
  requireTenant,
} from "@fmerp/shared/server/http";
import { createRoute, z } from "@hono/zod-openapi";
import { exportDownloadUrl, listExports, requestExport } from "../account-export";

const idParam = z.object({ id: z.uuid() });

const ExportItemSchema = z.object({
  id: z.string(),
  status: z.enum(["QUEUED", "RUNNING", "READY", "FAILED", "EXPIRED"]),
  requestedByName: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  size: z.number().nullable(),
  sha256: z.string().nullable(),
  expiresAt: z.string().nullable(),
  error: z.string().nullable(),
  downloads: z.array(z.object({ at: z.string(), userName: z.string().nullable() })),
});

/**
 * 계정 전체 내보내기 (PRD BAK-007·009). 소유자, 또는 소유자가 허용한 계정 관리자만. 요청·다운로드마다 PIN 재인증과 감사 로그.
 * ZIP은 worker가 만들고, 여기서는 요청 행과 이력·내려받기 URL만 다룬다.
 */
export function registerExportRoutes(app: AppRouter, deps: DepsProvider) {
  app.use("/account/exports", requireSession(deps), requireTenant(deps));
  app.use("/account/exports/*", requireSession(deps), requireTenant(deps));

  app.openapi(
    createRoute({
      method: "get",
      path: "/account/exports",
      tags: ["backup"],
      summary: "계정 내보내기 이력 (소유자 또는 허용된 계정 관리자)",
      responses: {
        200: json(z.object({ allowAdminExport: z.boolean(), items: z.array(ExportItemSchema) })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const result = await listExports(deps(), c.get("tenant"));
      return c.json(result as never, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/account/exports",
      tags: ["backup"],
      summary: "계정 내보내기 요청 (PIN 재인증). worker가 곧 ZIP을 만든다",
      responses: { 201: json(z.object({ id: z.string() })), ...errorResponses },
    }),
    async (c) => {
      const result = await requestExport(
        deps(),
        c.get("tenant"),
        c.get("session"),
        c.get("request"),
      );
      return c.json(result, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/account/exports/{id}/download",
      tags: ["backup"],
      summary: "완성된 내보내기 ZIP의 내려받기 URL (PIN 재인증, 감사 로그, 10분)",
      request: { params: idParam },
      responses: {
        200: json(
          z.object({ url: z.string(), filename: z.string(), expiresInSeconds: z.number() }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const result = await exportDownloadUrl(
        deps(),
        c.get("tenant"),
        c.get("session"),
        id,
        c.get("request"),
      );
      return c.json(result, 200);
    },
  );
}

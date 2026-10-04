import { Readable } from "node:stream";
import { withTenant } from "@fmerp/db";
import { createRoute, z } from "@hono/zod-openapi";
import {
  checkPackageDownload,
  openPackageZip,
  packagePdfUrl,
  packageStatus,
} from "../approval/package-download";
import type { AppRouter, DepsProvider } from "../http";
import { loadActor } from "../org-access";
import { errorResponses, json } from "./common";
import { createRequireReauth } from "./reauth";
import { serviceContext } from "./service-context";

const idParam = z.object({ id: z.uuid() });

/** 완료 문서 PDF·패키지 다운로드 (PRD APV-063, BAK-008). 세션·테넌트 검사는 /approvals/* 공통 미들웨어가 한다 */
export function registerPackageRoutes(app: AppRouter, deps: DepsProvider) {
  const requireReauth = createRequireReauth(deps);

  app.openapi(
    createRoute({
      method: "get",
      path: "/approvals/{id}/package",
      tags: ["approval"],
      summary: "완료 패키지(PDF) 생성 상태",
      request: { params: idParam },
      responses: {
        200: json(
          z.object({
            status: z.enum(["NONE", "PENDING", "READY", "FAILED"]),
            readyAt: z.string().nullable(),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor, membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return packageStatus(serviceContext(c, d, tx), id, { membershipId, actor });
      });
      return c.json({ status: result.status, readyAt: result.readyAt?.toISOString() ?? null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/approvals/{id}/package/pdf",
      tags: ["approval"],
      summary: "결재란이 찍힌 PDF 다운로드 서명 URL (열람 권한자, 감사 로그)",
      request: { params: idParam },
      responses: {
        200: json(z.object({ url: z.string(), filename: z.string() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor, membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return packagePdfUrl(serviceContext(c, d, tx), id, { membershipId, actor });
      });
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/approvals/{id}/package/zip",
      tags: ["approval"],
      summary: "패키지 ZIP(final/ 4개 파일 + 첨부) 스트리밍 다운로드 (PIN 재인증, 감사 로그)",
      request: { params: idParam, query: z.object({ check: z.enum(["1"]).optional() }) },
      responses: {
        200: {
          description: "ZIP (`check=1`이면 확인만 하고 `{ ok: true }`)",
          content: { "application/zip": { schema: z.string().openapi({ format: "binary" }) } },
        },
        428: { description: "PIN 재인증 필요" },
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const session = c.get("session");
      const { id } = c.req.valid("param");
      // 문서를 통째로 내려받는 일이라 재인증을 요구한다 (docs/rules/api.md)
      await requireReauth(tenant.accountId, session);
      if (c.req.valid("query").check === "1") {
        // 화면이 내려받기 전에 재인증·권한을 먼저 확인한다 (파일을 열지 않고 감사 로그도 남기지 않는다)
        await withTenant(d.appDb, tenant.accountId, async (tx) => {
          const { actor, membershipId } = await loadActor(tx, tenant, session.userId);
          await checkPackageDownload(serviceContext(c, d, tx), id, { membershipId, actor });
        });
        return c.json({ ok: true }, 200) as never;
      }
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor, membershipId } = await loadActor(tx, tenant, session.userId);
        return openPackageZip(serviceContext(c, d, tx), id, { membershipId, actor });
      });
      return new Response(Readable.toWeb(result.stream) as ReadableStream, {
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
          "cache-control": "no-store",
        },
      }) as never;
    },
  );
}

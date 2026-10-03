import { DOC_STATUSES } from "@fmerp/core";
import { withTenant } from "@fmerp/db";
import { createRoute, z } from "@hono/zod-openapi";
import { searchDocuments } from "../approval/search";
import { type AppRouter, type DepsProvider, requireSession, requireTenant } from "../http";
import { loadActor } from "../org-access";
import { errorResponses, json } from "./common";
import { serviceContext } from "./service-context";

const Item = z.object({
  id: z.string(),
  title: z.string(),
  docNo: z.string().nullable(),
  status: z.string(),
  urgent: z.boolean(),
  securityLevel: z.string(),
  drafterName: z.string(),
  createdAt: z.string(),
  submittedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** 문서 검색 (PRD APV-082). 결과는 열람 권한으로 걸러진다 */
export function registerSearchRoutes(app: AppRouter, deps: DepsProvider) {
  app.use("/search", requireSession(deps), requireTenant(deps));

  app.openapi(
    createRoute({
      method: "get",
      path: "/search",
      tags: ["approval"],
      summary: "문서 검색 (제목·문서번호·본문·첨부 파일명, 기안자·부서·양식·기간·상태·금액)",
      request: {
        query: z.object({
          q: z.string().trim().min(1).max(100).optional(),
          drafter: z.string().trim().min(1).max(50).optional(),
          departmentId: z.uuid().optional(),
          formId: z.uuid().optional(),
          status: z
            .string()
            .optional()
            .transform((v) => (v ? v.split(",") : undefined))
            .pipe(z.array(z.enum(DOC_STATUSES)).max(8).optional()),
          from: date.optional(),
          to: date.optional(),
          minAmount: z.coerce.number().int().min(0).optional(),
          maxAmount: z.coerce.number().int().min(0).optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
          cursor: z.string().max(200).optional(),
        }),
      },
      responses: {
        200: json(z.object({ items: z.array(Item), nextCursor: z.string().nullable() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { status, ...rest } = c.req.valid("query");
      const page = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor, membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return searchDocuments(
          serviceContext(c, d, tx),
          { membershipId, actor },
          { ...rest, statuses: status },
        );
      });
      return c.json(
        {
          items: page.items.map((i) => ({
            ...i,
            createdAt: i.createdAt.toISOString(),
            submittedAt: i.submittedAt?.toISOString() ?? null,
            completedAt: i.completedAt?.toISOString() ?? null,
          })),
          nextCursor: page.nextCursor,
        },
        200,
      );
    },
  );
}

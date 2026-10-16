import { withTenant } from "@fmerp/db";
import { loadActor } from "@fmerp/shared/authz/org-access";
import { errorResponses, json } from "@fmerp/shared/server/common";
import {
  type AppRouter,
  type DepsProvider,
  requireSession,
  requireTenant,
} from "@fmerp/shared/server/http";
import { serviceContext } from "@fmerp/shared/server/service-context";
import { createRoute, z } from "@hono/zod-openapi";
import { listMailbox, MAILBOXES } from "../service/mailbox";

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
  read: z.boolean(),
});

/** 개인·부서·감사 문서함 (PRD APV-080·081). 결재 대기는 /inbox/pending */
export function registerMailboxRoutes(app: AppRouter, deps: DepsProvider) {
  app.use("/mailbox", requireSession(deps), requireTenant(deps));
  app.use("/mailbox/*", requireSession(deps), requireTenant(deps));

  app.openapi(
    createRoute({
      method: "get",
      path: "/mailbox/{box}",
      tags: ["approval"],
      summary: "문서함 목록 (최근 만든 순, 커서 페이지네이션)",
      request: {
        params: z.object({ box: z.enum(MAILBOXES) }),
        query: z.object({
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
      const { box } = c.req.valid("param");
      const { limit, cursor } = c.req.valid("query");
      const page = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor, membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return listMailbox(
          serviceContext(c, d, tx),
          box,
          { membershipId, actor },
          { limit, cursor },
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

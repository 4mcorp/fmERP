import { withTenant } from "@fmerp/db";
import { loadActor } from "@fmerp/shared/authz/org-access";
import { createRequireReauth } from "@fmerp/shared/authz/reauth";
import { errorResponses, json } from "@fmerp/shared/server/common";
import {
  type AppRouter,
  type DepsProvider,
  requireSession,
  requireTenant,
} from "@fmerp/shared/server/http";
import { serviceContext } from "@fmerp/shared/server/service-context";
import { createRoute, z } from "@hono/zod-openapi";
import { listOverdue, transferAssignments } from "../approval/transfer";

/** 결재 문서 관리: 결재자 일괄 이관, 장기 미처리 목록 (PRD ADM-005, ORG-036) */
export function registerApprovalAdminRoutes(app: AppRouter, deps: DepsProvider) {
  app.use("/approval-admin/*", requireSession(deps), requireTenant(deps));
  const requireReauth = createRequireReauth(deps);

  app.openapi(
    createRoute({
      method: "post",
      path: "/approval-admin/transfer",
      tags: ["approval"],
      summary: "결재자 일괄 이관 (결재 관리자, PIN 재인증, 사유 필수)",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({
                fromMembershipId: z.uuid(),
                toMembershipId: z.uuid(),
                reason: z.string().trim().min(1).max(200),
              }),
            },
          },
        },
      },
      responses: {
        200: json(z.object({ documents: z.number().int(), steps: z.number().int() })),
        428: { description: "PIN 재인증 필요" },
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const session = c.get("session");
      const body = c.req.valid("json");
      await requireReauth(tenant.accountId, session);
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, session.userId);
        return transferAssignments(serviceContext(c, d, tx), { actor, ...body });
      });
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/approval-admin/overdue",
      tags: ["approval"],
      summary: "장기 미처리 진행 중 문서 (결재 관리 범위 안)",
      request: { query: z.object({ days: z.coerce.number().int().min(0).max(365).default(7) }) },
      responses: {
        200: json(
          z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              docNo: z.string().nullable(),
              businessId: z.string(),
              status: z.string(),
              drafterName: z.string(),
              waiting: z.array(z.unknown()),
              waitingDays: z.number().int(),
            }),
          ),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { days } = c.req.valid("query");
      const rows = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        return listOverdue(serviceContext(c, d, tx), actor, days);
      });
      return c.json(rows, 200);
    },
  );
}

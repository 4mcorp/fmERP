import { withTenant } from "@fmerp/db";
import { createRoute, z } from "@hono/zod-openapi";
import { addReview, queryAuditLogs, reviewOverview } from "../audit/logs";
import { documentTimeline, recordPrint } from "../audit/timeline";
import { type AppRouter, type DepsProvider, requireSession, requireTenant } from "../http";
import { loadActor } from "../org-access";
import { errorResponses, json, OkSchema } from "./common";
import { serviceContext } from "./service-context";

const idParam = z.object({ id: z.uuid() });

const TimelineItemSchema = z.object({
  at: z.string(),
  kind: z.string(),
  label: z.string(),
  actor: z.string().nullable(),
  onBehalfOf: z.string().nullable(),
  detail: z.string().nullable(),
  ip: z.string().nullable(),
});

const LogRowSchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  actorUserId: z.string().nullable(),
  actorName: z.string().nullable(),
  onBehalfOfName: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  targetLabel: z.string().nullable(),
  subjectName: z.string().nullable(),
  diff: z.unknown(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
  result: z.string(),
  reason: z.string().nullable(),
  masked: z.boolean(),
});

const ReviewMonthSchema = z.object({
  period: z.string(),
  state: z.enum(["pending", "done", "abnormal"]),
  last: z
    .object({
      id: z.string(),
      reviewedAt: z.string(),
      memo: z.string().nullable(),
      abnormal: z.boolean(),
      abnormalNote: z.string().nullable(),
      reviewerName: z.string(),
    })
    .nullable(),
});

/** 감사 기능: 문서 이력 타임라인·인쇄 기록, 감사 로그 조회, 월간 점검 (PRD AUD-011·020·025·026) */
export function registerAuditRoutes(app: AppRouter, deps: DepsProvider) {
  app.use("/audit-logs", requireSession(deps), requireTenant(deps));
  app.use("/audit-logs/*", requireSession(deps), requireTenant(deps));

  app.openapi(
    createRoute({
      method: "get",
      path: "/approvals/{id}/timeline",
      tags: ["audit"],
      summary: "문서 이력 타임라인 (문서 열람 권한자. 접속지·감사 열람은 감사 권한자에게만)",
      request: { params: idParam },
      responses: { 200: json(z.array(TimelineItemSchema)), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const items = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor, membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return documentTimeline(serviceContext(c, d, tx), id, { membershipId, actor });
      });
      return c.json(
        items.map((i) => ({ ...i, at: i.at.toISOString() })),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/approvals/{id}/print-log",
      tags: ["audit"],
      summary: "문서 인쇄 기록 (화면의 인쇄 버튼이 인쇄 직전에 호출)",
      request: { params: idParam },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor, membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        await recordPrint(serviceContext(c, d, tx), id, { membershipId, actor });
      });
      return c.json({ ok: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/audit-logs",
      tags: ["audit"],
      summary: "감사 로그 조회 (계정 범위 감사 권한자. 첫 쪽 조회는 로그에 남는다)",
      request: {
        query: z.object({
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
          actorUserId: z.uuid().optional(),
          action: z.string().min(1).max(100).optional(),
          targetType: z.string().min(1).max(50).optional(),
          targetId: z.string().min(1).max(100).optional(),
          result: z.enum(["success", "failure"]).optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
          cursor: z.string().max(200).optional(),
        }),
      },
      responses: {
        200: json(z.object({ items: z.array(LogRowSchema), nextCursor: z.string().nullable() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { limit, cursor, ...filters } = c.req.valid("query");
      const page = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        return queryAuditLogs(serviceContext(c, d, tx), actor, filters, { limit, cursor });
      });
      return c.json(
        {
          items: page.items.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() })),
          nextCursor: page.nextCursor,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/audit-logs/reviews",
      tags: ["audit"],
      summary: "월간 접속 기록 점검 현황 (최근 12개월, 직전 달부터)",
      responses: {
        200: json(
          z.object({
            targetPeriod: z.string(),
            overdue: z.boolean(),
            months: z.array(ReviewMonthSchema),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        return reviewOverview(serviceContext(c, d, tx), actor);
      });
      return c.json(
        {
          ...result,
          months: result.months.map((m) => ({
            period: m.period,
            state: m.state,
            last: m.last ? { ...m.last, reviewedAt: m.last.reviewedAt.toISOString() } : null,
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/audit-logs/reviews",
      tags: ["audit"],
      summary: "월간 접속 기록 점검 완료 기록 (점검자·일시는 서버가 채움)",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({
                period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
                memo: z.string().max(1000).optional(),
                abnormal: z.boolean(),
                abnormalNote: z.string().max(1000).optional(),
              }),
            },
          },
        },
      },
      responses: {
        201: json(z.object({ id: z.string(), reviewedAt: z.string() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const body = c.req.valid("json");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor, membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return addReview(serviceContext(c, d, tx), actor, membershipId, body);
      });
      return c.json({ id: result.id, reviewedAt: result.reviewedAt.toISOString() }, 201);
    },
  );
}

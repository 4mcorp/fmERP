import { withTenant } from "@fmerp/db";
import { createRoute, z } from "@hono/zod-openapi";
import {
  circulate,
  distributeDocument,
  listRecipients,
  receiveDocument,
  setRecipients,
} from "../approval/recipients";
import { type AppRouter, type DepsProvider, requireSession, requireTenant } from "../http";
import { loadActor } from "../org-access";
import { errorResponses, json, OkSchema } from "./common";
import { serviceContext } from "./service-context";

const idParam = z.object({ id: z.uuid() });
const recipientParam = z.object({ recipientId: z.uuid() });

const Target = z.object({ type: z.enum(["member", "department"]), id: z.uuid() });
const RecipientItem = z.object({
  kind: z.enum(["cc", "receive", "circulate"]),
  target: Target,
  assigneeMembershipId: z.uuid().nullish(),
});

/** 참조·수신·공람 지정, 접수, 배부 (PRD APV-070·072·073) */
export function registerRecipientRoutes(app: AppRouter, deps: DepsProvider) {
  app.use("/recipients", requireSession(deps), requireTenant(deps));
  app.use("/recipients/*", requireSession(deps), requireTenant(deps));

  app.openapi(
    createRoute({
      method: "put",
      path: "/approvals/{id}/recipients",
      tags: ["approval"],
      summary: "초안의 참조·수신·공람 대상 지정 (기안자)",
      request: {
        params: idParam,
        body: {
          content: {
            "application/json": { schema: z.object({ items: z.array(RecipientItem).max(50) }) },
          },
        },
      },
      responses: { 200: json(z.object({ count: z.number().int() })), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const { items } = c.req.valid("json");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return setRecipients(serviceContext(c, d, tx), {
          documentId: id,
          actorMembershipId: membershipId,
          items,
        });
      });
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/approvals/{id}/recipients",
      tags: ["approval"],
      summary: "참조·수신·공람 대상과 열람·접수·배부 상태 (열람 일시는 기안자·결재선 참여자만)",
      request: { params: idParam },
      responses: {
        200: json(
          z.array(
            z.object({
              id: z.string(),
              kind: z.string(),
              targetType: z.string(),
              targetId: z.string(),
              targetName: z.string(),
              assigneeMembershipId: z.string().nullable(),
              assigneeName: z.string().nullable(),
              canReceive: z.boolean(),
              canDistribute: z.boolean(),
              receivedByName: z.string().nullable(),
              receivedAt: z.string().nullable(),
              reads: z.array(
                z.object({
                  membershipId: z.string(),
                  name: z.string(),
                  readAt: z.string(),
                }),
              ),
              distributedTo: z.array(z.object({ membershipId: z.string(), name: z.string() })),
            }),
          ),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const rows = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor, membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return listRecipients(serviceContext(c, d, tx), id, { membershipId, actor });
      });
      return c.json(
        rows.map((r) => ({
          ...r,
          receivedAt: r.receivedAt?.toISOString() ?? null,
          reads: r.reads.map((x) => ({ ...x, readAt: x.readAt.toISOString() })),
        })),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/approvals/{id}/circulate",
      tags: ["approval"],
      summary: "완료된 문서를 사람·부서에게 공람으로 회람 (기안자·결재선 참여자)",
      request: {
        params: idParam,
        body: {
          content: {
            "application/json": { schema: z.object({ targets: z.array(Target).min(1).max(50) }) },
          },
        },
      },
      responses: { 200: json(z.object({ added: z.number().int() })), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const { targets } = c.req.valid("json");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor, membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return circulate(serviceContext(c, d, tx), {
          documentId: id,
          viewer: { membershipId, actor },
          targets,
        });
      });
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/recipients/{recipientId}/receive",
      tags: ["approval"],
      summary: "수신 접수 (지정 담당자, 없으면 수신 부서장)",
      request: { params: recipientParam },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { recipientId } = c.req.valid("param");
      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        await receiveDocument(serviceContext(c, d, tx), {
          recipientId,
          viewerMembershipId: membershipId,
        });
      });
      return c.json({ ok: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/recipients/{recipientId}/distribute",
      tags: ["approval"],
      summary: "수신 문서를 부서 안 담당자에게 배부 (접수자)",
      request: {
        params: recipientParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({ membershipIds: z.array(z.uuid()).min(1).max(50) }),
            },
          },
        },
      },
      responses: { 200: json(z.object({ count: z.number().int() })), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { recipientId } = c.req.valid("param");
      const { membershipIds } = c.req.valid("json");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return distributeDocument(serviceContext(c, d, tx), {
          recipientId,
          viewerMembershipId: membershipId,
          membershipIds,
        });
      });
      return c.json(result, 200);
    },
  );
}

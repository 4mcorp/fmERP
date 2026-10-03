import { computeAuditDiff, recordAudit } from "@fmerp/audit";
import { createInvitationToken, revokeSessionsInAccount } from "@fmerp/auth";
import { schema, withTenant } from "@fmerp/db";
import { createRoute, z } from "@hono/zod-openapi";
import { and, desc, eq, ne } from "drizzle-orm";
import {
  ApiError,
  type AppRouter,
  type DepsProvider,
  requireRole,
  requireSession,
  requireTenant,
} from "../http";
import { errorResponses, json, OkSchema } from "./common";

const INVITATION_DAYS = 7;

/**
 * 활성 회사(테넌트) 범위의 API. 모든 조회·변경은 withTenant 안에서 RLS가 적용된 fmerp_app으로 한다 (PRD PERM-002).
 */
export function registerAccountRoutes(app: AppRouter, deps: DepsProvider) {
  app.use("/account", requireSession(deps), requireTenant(deps));
  app.use("/account/*", requireSession(deps), requireTenant(deps));
  app.use("/account/invitations", requireRole("owner", "admin"));
  app.use("/account/invitations/*", requireRole("owner", "admin"));

  app.openapi(
    createRoute({
      method: "get",
      path: "/account",
      tags: ["account"],
      summary: "현재 회사 정보와 내 역할",
      responses: {
        200: json(z.object({ id: z.string(), name: z.string(), myRole: z.string() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const tenant = c.get("tenant");
      const [row] = await withTenant(deps().appDb, tenant.accountId, (tx) =>
        tx.select({ id: schema.account.id, name: schema.account.name }).from(schema.account),
      );
      if (!row) throw new ApiError(404, "not_found", "회사를 찾을 수 없습니다");
      return c.json({ ...row, myRole: tenant.role }, 200);
    },
  );

  // ===== 구성원 (PRD AUTH-015) =====
  const MemberSchema = z
    .object({
      userId: z.string(),
      name: z.string(),
      email: z.string(),
      role: z.string(),
      status: z.string(),
      joinedAt: z.string(),
    })
    .openapi("Member");

  app.openapi(
    createRoute({
      method: "get",
      path: "/account/members",
      tags: ["account"],
      summary: "구성원 목록",
      responses: { 200: json(z.array(MemberSchema)), ...errorResponses },
    }),
    async (c) => {
      const rows = await withTenant(deps().appDb, c.get("tenant").accountId, (tx) =>
        tx
          .select({
            userId: schema.membership.userId,
            name: schema.user.name,
            email: schema.user.email,
            role: schema.membership.role,
            status: schema.membership.status,
            joinedAt: schema.membership.joinedAt,
          })
          .from(schema.membership)
          .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId))
          .orderBy(schema.user.name),
      );
      return c.json(
        rows.map((r) => ({ ...r, joinedAt: r.joinedAt.toISOString() })),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/account/members/{userId}",
      tags: ["account"],
      summary: "구성원 비활성화·복귀 (비활성화 시 그 회사의 세션 즉시 종료)",
      middleware: [requireRole("owner", "admin")] as const,
      request: {
        params: z.object({ userId: z.uuid() }),
        body: {
          content: {
            "application/json": { schema: z.object({ status: z.enum(["active", "left"]) }) },
          },
        },
      },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const actorId = c.get("session").userId;
      const { userId } = c.req.valid("param");
      const { status } = c.req.valid("json");
      if (userId === actorId) {
        throw new ApiError(400, "validation_error", "본인 상태는 바꿀 수 없습니다");
      }

      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const [target] = await tx
          .select({ role: schema.membership.role, status: schema.membership.status })
          .from(schema.membership)
          .where(eq(schema.membership.userId, userId));
        if (!target) throw new ApiError(404, "not_found", "구성원이 아닙니다");
        if (target.role === "owner" && tenant.role !== "owner") {
          throw new ApiError(403, "forbidden", "소유자는 소유자만 변경할 수 있습니다");
        }
        if (target.role === "owner" && status === "left") {
          const owners = await tx
            .select({ userId: schema.membership.userId })
            .from(schema.membership)
            .where(
              and(
                eq(schema.membership.role, "owner"),
                eq(schema.membership.status, "active"),
                ne(schema.membership.userId, userId),
              ),
            );
          if (owners.length === 0) {
            throw new ApiError(409, "last_owner", "마지막 소유자는 비활성화할 수 없습니다");
          }
        }
        await tx
          .update(schema.membership)
          .set({ status, leftAt: status === "left" ? d.now() : null })
          .where(eq(schema.membership.userId, userId));
        await recordAudit(tx, {
          accountId: tenant.accountId,
          actorUserId: actorId,
          action: "member.status_change",
          target: { type: "membership", id: userId },
          subjectUserId: userId,
          diff: computeAuditDiff({ status: target.status }, { status }),
          result: "success",
          request: c.get("request"),
        });
      });

      if (status === "left") await revokeSessionsInAccount(d.authDb, userId, tenant.accountId);
      return c.json({ ok: true as const }, 200);
    },
  );

  // ===== 초대 (PRD AUTH-005 ②, AUTH-006) — 소유자·관리자 =====
  const InvitationSchema = z
    .object({
      id: z.string(),
      role: z.string(),
      email: z.string().nullable(),
      status: z.enum(["pending", "used", "expired", "revoked"]),
      expiresAt: z.string(),
      createdAt: z.string(),
    })
    .openapi("Invitation");

  app.openapi(
    createRoute({
      method: "get",
      path: "/account/invitations",
      tags: ["account"],
      summary: "초대 목록",
      responses: { 200: json(z.array(InvitationSchema)), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const now = d.now();
      const rows = await withTenant(d.appDb, c.get("tenant").accountId, (tx) =>
        tx.select().from(schema.invitation).orderBy(desc(schema.invitation.createdAt)),
      );
      return c.json(
        rows.map((r) => ({
          id: r.id,
          role: r.role,
          email: r.email,
          status: r.revokedAt
            ? ("revoked" as const)
            : r.usedAt
              ? ("used" as const)
              : r.expiresAt <= now
                ? ("expired" as const)
                : ("pending" as const),
          expiresAt: r.expiresAt.toISOString(),
          createdAt: r.createdAt.toISOString(),
        })),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/account/invitations",
      tags: ["account"],
      summary: "초대 링크 만들기 (링크는 이때 한 번만 보여 준다)",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({
                role: z.enum(["admin", "member"]).default("member"),
                email: z.email().optional(),
              }),
            },
          },
        },
      },
      responses: {
        201: json(z.object({ id: z.string(), token: z.string(), expiresAt: z.string() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const body = c.req.valid("json");
      const { token, tokenHash } = createInvitationToken();
      const expiresAt = new Date(d.now().getTime() + INVITATION_DAYS * 86_400_000);
      const created = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const [row] = await tx
          .insert(schema.invitation)
          .values({
            accountId: tenant.accountId,
            tokenHash,
            role: body.role,
            email: body.email,
            expiresAt,
            createdBy: c.get("session").userId,
          })
          .returning({ id: schema.invitation.id });
        if (!row) throw new Error("초대 생성 실패");
        await recordAudit(tx, {
          accountId: tenant.accountId,
          actorUserId: c.get("session").userId,
          action: "invitation.create",
          target: { type: "invitation", id: row.id, label: body.email },
          result: "success",
          request: c.get("request"),
        });
        return row;
      });
      return c.json({ id: created.id, token, expiresAt: expiresAt.toISOString() }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/account/invitations/{id}",
      tags: ["account"],
      summary: "초대 취소",
      request: { params: z.object({ id: z.uuid() }) },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const updated = await tx
          .update(schema.invitation)
          .set({ revokedAt: d.now() })
          .where(eq(schema.invitation.id, id))
          .returning({ id: schema.invitation.id });
        if (updated.length === 0) throw new ApiError(404, "not_found", "초대가 없습니다");
        await recordAudit(tx, {
          accountId: tenant.accountId,
          actorUserId: c.get("session").userId,
          action: "invitation.revoke",
          target: { type: "invitation", id },
          result: "success",
          request: c.get("request"),
        });
      });
      return c.json({ ok: true as const }, 200);
    },
  );
}

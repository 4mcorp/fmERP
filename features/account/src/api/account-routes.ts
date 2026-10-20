import { recordAudit } from "@fmerp/audit";
import { schema, withTenant } from "@fmerp/db";
import {
  ACCOUNT_TARGET,
  authorize,
  businessTarget,
  loadActor,
} from "@fmerp/shared/authz/org-access";
import { requireStrictReauth } from "@fmerp/shared/authz/reauth";
import { can, canInAnyScope } from "@fmerp/shared/domain/permissions";
import { errorResponses, json, OkSchema } from "@fmerp/shared/server/common";
import {
  ApiError,
  type AppRouter,
  type DepsProvider,
  requireSession,
  requireTenant,
} from "@fmerp/shared/server/http";
import { createRoute, z } from "@hono/zod-openapi";
import { and, desc, eq } from "drizzle-orm";
import { EnrollmentError } from "../domain/enrollment";
import { createInvitationToken } from "../service/accounts";
import {
  issueEnrollmentToken,
  preRegisterMember,
  reissueMemberEnrollment,
} from "../service/enrollment";
import { resetMemberPasskeys } from "../service/passkey-reset";

const INVITATION_DAYS = 7;

const PresetSchema = z.object({
  businessId: z.uuid(),
  departmentId: z.uuid(),
  positionId: z.uuid().nullable().optional(),
  dutyId: z.uuid().nullable().optional(),
});

/**
 * 활성 회사(테넌트) 범위의 API. 모든 조회·변경은 withTenant 안에서 RLS가 적용된 fmerp_app으로 한다 (PRD PERM-002).
 * 구성원·소속·역할 API는 members.ts, 설정·사업자·직위는 org.ts, 부서·조직도는 departments.ts.
 */
export function registerAccountRoutes(app: AppRouter, deps: DepsProvider) {
  app.use("/account", requireSession(deps), requireTenant(deps));
  app.use("/account/*", requireSession(deps), requireTenant(deps));

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

  // ===== 초대 (PRD AUTH-005 ②, AUTH-006) — 소유자·관리자, 사업자 관리자는 자기 사업자 범위 =====
  const InvitationSchema = z
    .object({
      id: z.string(),
      role: z.string(),
      email: z.string().nullable(),
      preset: z.record(z.string(), z.unknown()),
      status: z.enum(["pending", "used", "expired", "revoked"]),
      expiresAt: z.string(),
      createdAt: z.string(),
    })
    .openapi("Invitation");

  const presetBusinessId = (preset: Record<string, unknown>) =>
    typeof preset.businessId === "string" ? preset.businessId : null;

  app.openapi(
    createRoute({
      method: "get",
      path: "/account/invitations",
      tags: ["account"],
      summary: "초대 목록 (내 권한 범위의 초대만)",
      responses: { 200: json(z.array(InvitationSchema)), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const now = d.now();
      const tenant = c.get("tenant");
      const rows = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        if (!canInAnyScope(actor, "member.invite")) {
          throw new ApiError(403, "forbidden", "권한이 없습니다");
        }
        const all = await tx
          .select()
          .from(schema.invitation)
          .orderBy(desc(schema.invitation.createdAt));
        return all.filter((r) => {
          const businessId = presetBusinessId(r.preset);
          return can(
            actor,
            "member.invite",
            businessId ? businessTarget(businessId) : ACCOUNT_TARGET,
          );
        });
      });
      return c.json(
        rows.map((r) => ({
          id: r.id,
          role: r.role,
          email: r.email,
          preset: r.preset,
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
      summary:
        "초대 링크 만들기 (링크는 이때 한 번만 보여 준다). 사업자·부서·직위를 미리 지정할 수 있다",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({
                role: z.enum(["admin", "member"]).default("member"),
                email: z.email().optional(),
                preset: PresetSchema.optional(),
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
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        authorize(
          actor,
          "member.invite",
          body.preset ? businessTarget(body.preset.businessId) : ACCOUNT_TARGET,
        );
        // 관리자 역할 초대는 역할 부여 권한자만 (사업자 관리자의 권한 상승 방지)
        if (body.role === "admin") authorize(actor, "role.grant", ACCOUNT_TARGET);

        let preset: Record<string, unknown> = {};
        if (body.preset) {
          const p = body.preset;
          const [dept] = await tx
            .select({ id: schema.department.id, active: schema.department.active })
            .from(schema.department)
            .where(
              and(
                eq(schema.department.id, p.departmentId),
                eq(schema.department.businessId, p.businessId),
              ),
            );
          if (!dept?.active) {
            throw new ApiError(400, "validation_error", "지정한 부서를 사용할 수 없습니다");
          }
          if (p.positionId) {
            const [pos] = await tx
              .select({ id: schema.position.id })
              .from(schema.position)
              .where(and(eq(schema.position.id, p.positionId), eq(schema.position.active, true)));
            if (!pos)
              throw new ApiError(400, "validation_error", "지정한 직위를 사용할 수 없습니다");
          }
          if (p.dutyId) {
            const [duty] = await tx
              .select({ id: schema.duty.id })
              .from(schema.duty)
              .where(and(eq(schema.duty.id, p.dutyId), eq(schema.duty.active, true)));
            if (!duty)
              throw new ApiError(400, "validation_error", "지정한 직책을 사용할 수 없습니다");
          }
          preset = {
            businessId: p.businessId,
            departmentId: p.departmentId,
            positionId: p.positionId ?? null,
            dutyId: p.dutyId ?? null,
          };
        }

        const [row] = await tx
          .insert(schema.invitation)
          .values({
            accountId: tenant.accountId,
            tokenHash,
            role: body.role,
            email: body.email,
            preset,
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
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        const [inv] = await tx.select().from(schema.invitation).where(eq(schema.invitation.id, id));
        if (!inv) throw new ApiError(404, "not_found", "초대가 없습니다");
        const businessId = presetBusinessId(inv.preset);
        authorize(actor, "member.invite", businessId ? businessTarget(businessId) : ACCOUNT_TARGET);
        await tx
          .update(schema.invitation)
          .set({ revokedAt: d.now() })
          .where(eq(schema.invitation.id, id));
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

  // ===== 구성원 passkey 초기화 (PK1c). 계정 관리자 이상만, 결재 PIN 재인증 후 =====
  app.openapi(
    createRoute({
      method: "post",
      path: "/account/members/{userId}/passkey-reset",
      tags: ["account"],
      summary:
        "구성원 passkey 전체 삭제·세션 종료 후 새 등록 토큰 발급 (토큰은 이때 한 번만 보여 준다). 결재 PIN 재인증 필요",
      request: { params: z.object({ userId: z.uuid() }) },
      responses: {
        200: json(
          z.object({
            token: z.string(),
            expiresAt: z.string(),
            removedPasskeys: z.number(),
            endedSessions: z.number(),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const session = c.get("session");
      const { userId: targetUserId } = c.req.valid("param");
      // 권한 확인을 먼저 한다: 권한 없는 사람에게 재인증 요구(428)로 응답하지 않는다
      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, session.userId);
        authorize(actor, "member.passkey_reset", ACCOUNT_TARGET);
        // 소유자의 passkey는 소유자만 초기화한다. 관리자가 소유자 계정을 넘겨받는 길을 막는다 (role.grant와 같은 이유)
        const [target] = await tx
          .select({ role: schema.membership.role })
          .from(schema.membership)
          .where(
            and(
              eq(schema.membership.accountId, tenant.accountId),
              eq(schema.membership.userId, targetUserId),
            ),
          );
        if (target?.role === "owner" && tenant.role !== "owner") {
          throw new ApiError(403, "forbidden", "소유자의 passkey는 소유자만 초기화할 수 있습니다");
        }
      });
      await requireStrictReauth(d, session);
      const result = await resetMemberPasskeys(
        { appDb: d.appDb, authDb: d.authDb },
        {
          accountId: tenant.accountId,
          actorUserId: session.userId,
          targetUserId,
          now: d.now(),
          request: c.get("request"),
        },
      );
      if (!result) throw new ApiError(404, "not_found", "구성원을 찾을 수 없습니다");
      return c.json(
        {
          token: result.token,
          expiresAt: result.expiresAt.toISOString(),
          removedPasskeys: result.removedPasskeys,
          endedSessions: result.endedSessions,
        },
        200,
      );
    },
  );

  // ===== 관리자 사전 등록 (PK1d). 계정 관리자 이상만, 결재 PIN 재인증 후 =====
  // 권한 행위는 passkey 초기화와 같은 `member.passkey_reset`(소유자·관리자)을 쓴다. 사업자 관리자는 제외된다.
  app.openapi(
    createRoute({
      method: "post",
      path: "/account/members",
      tags: ["account"],
      summary:
        "구성원 사전 등록 + passkey 등록 링크 발급 (링크는 이때 한 번만 보여 준다). 결재 PIN 재인증 필요",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({
                email: z.email().max(254),
                name: z.string().trim().min(1).max(100),
              }),
            },
          },
        },
      },
      responses: {
        201: json(
          z.object({
            userId: z.string(),
            created: z.boolean(),
            token: z.string(),
            expiresAt: z.string(),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const session = c.get("session");
      const body = c.req.valid("json");
      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, session.userId);
        authorize(actor, "member.passkey_reset", ACCOUNT_TARGET);
      });
      await requireStrictReauth(d, session);
      const enrollDeps = { appDb: d.appDb, authDb: d.authDb };
      const now = d.now();
      let pre: Awaited<ReturnType<typeof preRegisterMember>>;
      try {
        pre = await preRegisterMember(enrollDeps, {
          accountId: tenant.accountId,
          email: body.email,
          name: body.name,
          now,
          actorUserId: session.userId,
          request: c.get("request"),
        });
      } catch (e) {
        if (e instanceof EnrollmentError) {
          throw new ApiError(400, "validation_error", e.message);
        }
        throw e;
      }
      // 다른 회사 소속·passkey 보유·소속 없는 기존 사용자는 모두 같은 응답으로 거부한다 (사유는 감사 로그에만 남는다)
      if (pre.rejected) {
        throw new ApiError(409, "enrollment_email_unavailable", "사용할 수 없는 이메일입니다");
      }
      if (!pre.joined) {
        throw new ApiError(
          409,
          "member_exists",
          "이미 이 회사의 구성원입니다. 기기를 잃었다면 passkey 초기화를 사용하세요",
        );
      }
      const issued = await issueEnrollmentToken(enrollDeps, {
        accountId: tenant.accountId,
        userId: pre.userId,
        createdBy: session.userId,
        now,
        request: c.get("request"),
        auditAction: "member.enrollment_issue",
      });
      return c.json(
        {
          userId: pre.userId,
          created: pre.created,
          token: issued.token,
          expiresAt: issued.expiresAt.toISOString(),
        },
        201,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/account/members/{userId}/enrollment",
      tags: ["account"],
      summary:
        "passkey가 없는 구성원에게 등록 링크 재발급 (이전 미사용 링크는 무효). passkey가 있으면 거부한다. 결재 PIN 재인증 필요",
      request: { params: z.object({ userId: z.uuid() }) },
      responses: {
        200: json(z.object({ token: z.string(), expiresAt: z.string() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const session = c.get("session");
      const { userId: targetUserId } = c.req.valid("param");
      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, session.userId);
        authorize(actor, "member.passkey_reset", ACCOUNT_TARGET);
        // 소유자 계정은 소유자만 건드린다 (passkey 초기화와 같은 규칙)
        const [target] = await tx
          .select({ role: schema.membership.role })
          .from(schema.membership)
          .where(
            and(
              eq(schema.membership.accountId, tenant.accountId),
              eq(schema.membership.userId, targetUserId),
            ),
          );
        if (target?.role === "owner" && tenant.role !== "owner") {
          throw new ApiError(403, "forbidden", "소유자의 등록 링크는 소유자만 발급할 수 있습니다");
        }
      });
      await requireStrictReauth(d, session);
      const result = await reissueMemberEnrollment(
        { appDb: d.appDb, authDb: d.authDb },
        {
          accountId: tenant.accountId,
          actorUserId: session.userId,
          targetUserId,
          now: d.now(),
          request: c.get("request"),
        },
      );
      if (result.status === "not_member") {
        throw new ApiError(404, "not_found", "구성원을 찾을 수 없습니다");
      }
      if (result.status === "has_passkey") {
        throw new ApiError(
          409,
          "has_passkey",
          "이미 passkey가 있습니다. 기기를 잃었다면 passkey 초기화를 사용하세요",
        );
      }
      return c.json({ token: result.token, expiresAt: result.expiresAt.toISOString() }, 200);
    },
  );
}

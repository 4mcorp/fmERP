import { computeAuditDiff, recordAudit } from "@fmerp/audit";
import {
  GRANT_ROLES,
  type GrantRole,
  grantScopeAllowed,
  SCOPE_TYPES,
  type ScopeType,
} from "@fmerp/core";
import { schema, type Tx, withTenant } from "@fmerp/db";
import { revokeSessionsInAccount } from "@fmerp/shared/authz/membership";
import {
  ACCOUNT_TARGET,
  authorize,
  authorizeForMember,
  businessTarget,
  loadActor,
} from "@fmerp/shared/authz/org-access";
import { errorResponses, json, OkSchema } from "@fmerp/shared/server/common";
import { ApiError, type AppRouter, type DepsProvider } from "@fmerp/shared/server/http";
import { createRoute, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { type AssignmentInput, assignmentChanges, validateAssignments } from "../domain/assignment";
import { countInFlightForMember } from "../service/in-flight";

const MemberSchema = z
  .object({
    userId: z.string(),
    membershipId: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.string(),
    status: z.string(),
    employeeNo: z.string().nullable(),
    joinedAt: z.string(),
    assignments: z.array(
      z.object({
        id: z.string(),
        businessId: z.string(),
        businessName: z.string(),
        departmentId: z.string(),
        departmentName: z.string(),
        positionId: z.string().nullable(),
        positionName: z.string().nullable(),
        dutyId: z.string().nullable(),
        dutyName: z.string().nullable(),
        isPrimary: z.boolean(),
      }),
    ),
    grants: z.array(
      z.object({
        id: z.string(),
        role: z.string(),
        scopeType: z.string(),
        scopeId: z.string().nullable(),
        scopeLabel: z.string(),
      }),
    ),
  })
  .openapi("Member");

const AssignmentInputSchema = z.object({
  businessId: z.uuid(),
  departmentId: z.uuid(),
  positionId: z.uuid().nullable().optional(),
  dutyId: z.uuid().nullable().optional(),
  isPrimary: z.boolean(),
});

async function memberByUserId(tx: Tx, userId: string) {
  const [m] = await tx
    .select({
      id: schema.membership.id,
      role: schema.membership.role,
      status: schema.membership.status,
      employeeNo: schema.membership.employeeNo,
    })
    .from(schema.membership)
    .where(eq(schema.membership.userId, userId));
  if (!m) throw new ApiError(404, "not_found", "구성원이 아닙니다");
  return m;
}

/** 구성원 목록·상태·소속(겸직)·발령 이력·역할 부여 (PRD ORG-032~035, PERM-001, AUTH-015) */
export function registerMemberRoutes(app: AppRouter, deps: DepsProvider) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/account/members",
      tags: ["account"],
      summary: "구성원 목록 (소속·역할 포함)",
      responses: { 200: json(z.array(MemberSchema)), ...errorResponses },
    }),
    async (c) => {
      const rows = await withTenant(deps().appDb, c.get("tenant").accountId, async (tx) => {
        const members = await tx
          .select({
            userId: schema.membership.userId,
            membershipId: schema.membership.id,
            name: schema.user.name,
            email: schema.user.email,
            role: schema.membership.role,
            status: schema.membership.status,
            employeeNo: schema.membership.employeeNo,
            joinedAt: schema.membership.joinedAt,
          })
          .from(schema.membership)
          .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId))
          .orderBy(asc(schema.user.name));
        const assignments = await tx
          .select({
            id: schema.assignment.id,
            membershipId: schema.assignment.membershipId,
            businessId: schema.assignment.businessId,
            businessName: schema.business.name,
            departmentId: schema.assignment.departmentId,
            departmentName: schema.department.name,
            positionId: schema.assignment.positionId,
            positionName: schema.position.name,
            dutyId: schema.assignment.dutyId,
            dutyName: schema.duty.name,
            isPrimary: schema.assignment.isPrimary,
          })
          .from(schema.assignment)
          .innerJoin(schema.business, eq(schema.business.id, schema.assignment.businessId))
          .innerJoin(schema.department, eq(schema.department.id, schema.assignment.departmentId))
          .leftJoin(schema.position, eq(schema.position.id, schema.assignment.positionId))
          .leftJoin(schema.duty, eq(schema.duty.id, schema.assignment.dutyId))
          .where(isNull(schema.assignment.validTo));
        const grants = await tx.select().from(schema.roleGrant);
        const businesses = await tx
          .select({ id: schema.business.id, name: schema.business.name })
          .from(schema.business);
        const departments = await tx
          .select({ id: schema.department.id, name: schema.department.name })
          .from(schema.department);
        const label = (g: (typeof grants)[number]) =>
          g.scopeType === "account"
            ? "계정 전체"
            : g.scopeType === "business"
              ? (businesses.find((b) => b.id === g.scopeId)?.name ?? "(삭제됨)")
              : `${departments.find((x) => x.id === g.scopeId)?.name ?? "(삭제됨)"} 및 하위`;
        return members.map((m) => ({
          ...m,
          joinedAt: m.joinedAt.toISOString(),
          assignments: assignments.filter((a) => a.membershipId === m.membershipId),
          grants: grants
            .filter((g) => g.membershipId === m.membershipId)
            .map((g) => ({
              id: g.id,
              role: g.role,
              scopeType: g.scopeType,
              scopeId: g.scopeId,
              scopeLabel: label(g),
            })),
        }));
      });
      return c.json(rows, 200);
    },
  );

  // ===== 상태·사번 (AUTH-015, ORG-034) =====
  app.openapi(
    createRoute({
      method: "patch",
      path: "/account/members/{userId}",
      tags: ["account"],
      summary: "구성원 상태(재직·휴직·퇴사)·사번 변경 (퇴사·휴직이면 그 회사의 세션 즉시 종료)",
      request: {
        params: z.object({ userId: z.uuid() }),
        body: {
          content: {
            "application/json": {
              schema: z.object({
                status: z.enum(["active", "leave", "left"]).optional(),
                employeeNo: z.string().trim().min(1).max(30).nullable().optional(),
              }),
            },
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
      const patch = c.req.valid("json");
      if (patch.status === undefined && patch.employeeNo === undefined) {
        throw new ApiError(400, "validation_error", "변경할 값이 없습니다");
      }
      if (userId === actorId && patch.status !== undefined) {
        throw new ApiError(400, "validation_error", "본인 상태는 바꿀 수 없습니다");
      }

      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, actorId);
        // 소유자 동시 변경 경쟁 조건을 막기 위해 소유자 행을 id 순서로 잠근다 (M1 후속 FU-3)
        const owners = await tx
          .select({ userId: schema.membership.userId, status: schema.membership.status })
          .from(schema.membership)
          .where(eq(schema.membership.role, "owner"))
          .orderBy(asc(schema.membership.id))
          .for("update");
        const target = await memberByUserId(tx, userId);
        if (patch.status !== undefined) {
          await authorizeForMember(tx, actor, "member.deactivate", target.id);
          if (target.role !== "member" && tenant.role === "member") {
            throw new ApiError(403, "forbidden", "소유자·관리자는 변경할 수 없습니다");
          }
          if (target.role === "owner" && tenant.role !== "owner") {
            throw new ApiError(403, "forbidden", "소유자는 소유자만 변경할 수 있습니다");
          }
          if (
            target.role === "owner" &&
            patch.status !== "active" &&
            !owners.some((o) => o.userId !== userId && o.status === "active")
          ) {
            throw new ApiError(409, "last_owner", "마지막 소유자는 비활성화할 수 없습니다");
          }
          // 퇴사·휴직 전에 처리 전 결재를 대체 결재자에게 이관해야 한다 (ORG-036, ADM-005)
          if (patch.status !== "active" && target.status === "active") {
            const pending = await countInFlightForMember(tx, target.id);
            if (pending > 0) {
              throw new ApiError(
                409,
                "in_flight",
                `처리 전 결재 ${pending}건이 있습니다. 대체 결재자에게 먼저 이관하세요`,
              );
            }
          }
        }
        if (patch.employeeNo !== undefined) {
          await authorizeForMember(tx, actor, "assignment.manage", target.id);
        }
        const next = {
          status: patch.status ?? target.status,
          employeeNo: patch.employeeNo === undefined ? target.employeeNo : patch.employeeNo,
        };
        await tx
          .update(schema.membership)
          .set({
            ...next,
            leftAt:
              next.status === "active" ? null : target.status === "active" ? d.now() : undefined,
          })
          .where(eq(schema.membership.id, target.id));
        await recordAudit(tx, {
          accountId: tenant.accountId,
          actorUserId: actorId,
          action: patch.status !== undefined ? "member.status_change" : "member.update",
          target: { type: "membership", id: userId },
          subjectUserId: userId,
          diff: computeAuditDiff({ status: target.status, employeeNo: target.employeeNo }, next),
          result: "success",
          request: c.get("request"),
        });
      });

      if (patch.status === "left" || patch.status === "leave") {
        await revokeSessionsInAccount(d.authDb, userId, tenant.accountId);
      }
      return c.json({ ok: true as const }, 200);
    },
  );

  // ===== 소속·겸직·발령 (ORG-032·033·035) =====
  app.openapi(
    createRoute({
      method: "put",
      path: "/account/members/{userId}/assignments",
      tags: ["account"],
      summary:
        "구성원의 소속 목록 전체 교체 (주소속 1개, 겸직 허용). 변경분은 발령 이력으로 남는다",
      request: {
        params: z.object({ userId: z.uuid() }),
        body: {
          content: {
            "application/json": {
              schema: z.object({
                assignments: z.array(AssignmentInputSchema).max(10),
                effectiveDate: z.iso.date().optional(),
                reason: z.string().trim().max(200).optional(),
              }),
            },
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
      const body = c.req.valid("json");
      const now = d.now();
      const effectiveDate = body.effectiveDate ?? now.toISOString().slice(0, 10);

      const keys = body.assignments.map((a) => a.departmentId);
      if (new Set(keys).size !== keys.length) {
        throw new ApiError(400, "validation_error", "같은 부서를 두 번 지정할 수 없습니다");
      }
      const asInput = body.assignments.map(
        (a): AssignmentInput => ({
          id: a.departmentId,
          businessId: a.businessId,
          departmentId: a.departmentId,
          positionId: a.positionId ?? null,
          dutyId: a.dutyId ?? null,
          isPrimary: a.isPrimary,
          validFrom: now,
          validTo: null,
        }),
      );
      if (asInput.length > 0 && validateAssignments(asInput, now).ok === false) {
        throw new ApiError(400, "validation_error", "주소속은 정확히 1개여야 합니다");
      }

      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, actorId);
        const target = await memberByUserId(tx, userId);
        const current = await tx
          .select()
          .from(schema.assignment)
          .where(
            and(eq(schema.assignment.membershipId, target.id), isNull(schema.assignment.validTo)),
          );

        // 기존·신규 소속의 사업자 모두에 대해 권한이 있어야 한다
        const businessIds = new Set([
          ...current.map((x) => x.businessId),
          ...body.assignments.map((a) => a.businessId),
        ]);
        if (businessIds.size === 0) authorize(actor, "assignment.manage", ACCOUNT_TARGET);
        for (const id of businessIds) authorize(actor, "assignment.manage", businessTarget(id));

        const history: (typeof schema.assignmentHistory.$inferInsert)[] = [];
        const record = (
          assignmentId: string | null,
          action: "create" | "update" | "end",
          changes: Record<string, unknown>,
        ) =>
          history.push({
            accountId: tenant.accountId,
            membershipId: target.id,
            assignmentId,
            action,
            changes,
            effectiveDate,
            reason: body.reason,
            actorUserId: actorId,
          });

        const incoming = new Map(body.assignments.map((a) => [a.departmentId, a]));
        const currentByDept = new Map(current.map((x) => [x.departmentId, x]));

        for (const cur of current) {
          if (!incoming.has(cur.departmentId)) {
            await tx
              .update(schema.assignment)
              .set({ validTo: now })
              .where(eq(schema.assignment.id, cur.id));
            record(cur.id, "end", { departmentId: { from: cur.departmentId, to: null } });
          }
        }
        const updates = [...incoming.values()]
          .filter((a) => currentByDept.has(a.departmentId))
          .sort((a, b) => Number(a.isPrimary) - Number(b.isPrimary));
        for (const a of updates) {
          const cur = currentByDept.get(a.departmentId);
          if (!cur) continue;
          const before = asInputFromRow(cur);
          const after = {
            ...before,
            positionId: a.positionId ?? null,
            dutyId: a.dutyId ?? null,
            isPrimary: a.isPrimary,
          };
          const changes = assignmentChanges(before, after);
          if (Object.keys(changes).length === 0) continue;
          await tx
            .update(schema.assignment)
            .set({ positionId: after.positionId, dutyId: after.dutyId, isPrimary: after.isPrimary })
            .where(eq(schema.assignment.id, cur.id));
          record(cur.id, "update", changes);
        }
        for (const a of [...incoming.values()].filter((x) => !currentByDept.has(x.departmentId))) {
          const [row] = await tx
            .insert(schema.assignment)
            .values({
              accountId: tenant.accountId,
              membershipId: target.id,
              businessId: a.businessId,
              departmentId: a.departmentId,
              positionId: a.positionId ?? null,
              dutyId: a.dutyId ?? null,
              isPrimary: a.isPrimary,
            })
            .returning({ id: schema.assignment.id });
          record(row?.id ?? null, "create", {
            businessId: a.businessId,
            departmentId: a.departmentId,
            positionId: a.positionId ?? null,
            dutyId: a.dutyId ?? null,
            isPrimary: a.isPrimary,
          });
        }
        if (history.length > 0) await tx.insert(schema.assignmentHistory).values(history);
        await recordAudit(tx, {
          accountId: tenant.accountId,
          actorUserId: actorId,
          action: "member.assignments_update",
          target: { type: "membership", id: userId },
          subjectUserId: userId,
          diff: computeAuditDiff(
            { assignments: current.map(summaryOf) },
            {
              assignments: body.assignments.map((a) =>
                summaryOf({ ...a, positionId: a.positionId ?? null, dutyId: a.dutyId ?? null }),
              ),
            },
          ),
          result: "success",
          request: c.get("request"),
        });
      });
      return c.json({ ok: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/account/members/{userId}/assignment-history",
      tags: ["account"],
      summary: "발령 이력 (본인 또는 발령 권한자)",
      request: { params: z.object({ userId: z.uuid() }) },
      responses: {
        200: json(
          z.array(
            z.object({
              id: z.string(),
              action: z.string(),
              changes: z.record(z.string(), z.unknown()),
              effectiveDate: z.string(),
              reason: z.string().nullable(),
              actorName: z.string().nullable(),
            }),
          ),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const tenant = c.get("tenant");
      const actorId = c.get("session").userId;
      const { userId } = c.req.valid("param");
      const rows = await withTenant(deps().appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, actorId);
        const target = await memberByUserId(tx, userId);
        if (userId !== actorId) await authorizeForMember(tx, actor, "assignment.manage", target.id);
        return tx
          .select({
            id: schema.assignmentHistory.id,
            action: schema.assignmentHistory.action,
            changes: schema.assignmentHistory.changes,
            effectiveDate: schema.assignmentHistory.effectiveDate,
            reason: schema.assignmentHistory.reason,
            actorName: schema.user.name,
          })
          .from(schema.assignmentHistory)
          .leftJoin(schema.user, eq(schema.user.id, schema.assignmentHistory.actorUserId))
          .where(eq(schema.assignmentHistory.membershipId, target.id))
          .orderBy(desc(schema.assignmentHistory.createdAt));
      });
      return c.json(rows, 200);
    },
  );

  // ===== 역할 부여 (PERM-001, ADM-003) =====
  app.openapi(
    createRoute({
      method: "post",
      path: "/account/members/{userId}/roles",
      tags: ["account"],
      summary: "역할을 범위와 함께 부여 (모든 권한 변경은 감사 로그)",
      request: {
        params: z.object({ userId: z.uuid() }),
        body: {
          content: {
            "application/json": {
              schema: z.object({
                role: z.enum(GRANT_ROLES),
                scopeType: z.enum(SCOPE_TYPES),
                scopeId: z.uuid().nullable().optional(),
              }),
            },
          },
        },
      },
      responses: { 201: json(z.object({ id: z.string() })), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const actorId = c.get("session").userId;
      const { userId } = c.req.valid("param");
      const body = c.req.valid("json");
      if (!grantScopeAllowed(body.role as GrantRole, body.scopeType as ScopeType)) {
        throw new ApiError(400, "validation_error", "이 역할에는 해당 범위를 부여할 수 없습니다");
      }
      if ((body.scopeType === "account") !== !body.scopeId) {
        throw new ApiError(400, "validation_error", "범위 유형과 범위 대상이 맞지 않습니다");
      }
      const created = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, actorId);
        authorize(actor, "role.grant", ACCOUNT_TARGET);
        const target = await memberByUserId(tx, userId);
        const [row] = await tx
          .insert(schema.roleGrant)
          .values({
            accountId: tenant.accountId,
            membershipId: target.id,
            role: body.role,
            scopeType: body.scopeType,
            scopeId: body.scopeId ?? null,
            createdBy: actorId,
          })
          .returning({ id: schema.roleGrant.id });
        if (!row) throw new Error("역할 부여 실패");
        await recordAudit(tx, {
          accountId: tenant.accountId,
          actorUserId: actorId,
          action: "role.grant",
          target: { type: "role_grant", id: row.id, label: body.role },
          subjectUserId: userId,
          diff: computeAuditDiff(
            {},
            { role: body.role, scopeType: body.scopeType, scopeId: body.scopeId ?? null },
          ),
          result: "success",
          request: c.get("request"),
        });
        return row;
      });
      return c.json({ id: created.id }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/account/members/{userId}/roles/{grantId}",
      tags: ["account"],
      summary: "역할 회수",
      request: { params: z.object({ userId: z.uuid(), grantId: z.uuid() }) },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const actorId = c.get("session").userId;
      const { userId, grantId } = c.req.valid("param");
      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, actorId);
        authorize(actor, "role.grant", ACCOUNT_TARGET);
        const target = await memberByUserId(tx, userId);
        const rows = await tx
          .delete(schema.roleGrant)
          .where(
            and(eq(schema.roleGrant.id, grantId), eq(schema.roleGrant.membershipId, target.id)),
          )
          .returning();
        const row = rows[0];
        if (!row) throw new ApiError(404, "not_found", "부여된 역할이 없습니다");
        await recordAudit(tx, {
          accountId: tenant.accountId,
          actorUserId: actorId,
          action: "role.revoke",
          target: { type: "role_grant", id: grantId, label: row.role },
          subjectUserId: userId,
          diff: computeAuditDiff(
            { role: row.role, scopeType: row.scopeType, scopeId: row.scopeId },
            {},
          ),
          result: "success",
          request: c.get("request"),
        });
      });
      return c.json({ ok: true as const }, 200);
    },
  );
}

function asInputFromRow(a: typeof schema.assignment.$inferSelect): AssignmentInput {
  return {
    id: a.id,
    businessId: a.businessId,
    departmentId: a.departmentId,
    positionId: a.positionId,
    dutyId: a.dutyId,
    isPrimary: a.isPrimary,
    validFrom: a.validFrom,
    validTo: a.validTo,
  };
}

function summaryOf(a: {
  businessId: string;
  departmentId: string;
  positionId: string | null;
  dutyId: string | null;
  isPrimary: boolean;
}) {
  return {
    businessId: a.businessId,
    departmentId: a.departmentId,
    positionId: a.positionId,
    dutyId: a.dutyId,
    isPrimary: a.isPrimary,
  };
}

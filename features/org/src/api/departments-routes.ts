import { computeAuditDiff, recordAudit } from "@fmerp/audit";
import { schema, type Tx, withTenant } from "@fmerp/db";
import {
  authorize,
  businessTarget,
  departmentTarget,
  loadActor,
} from "@fmerp/shared/authz/org-access";
import { errorResponses, json, OkSchema } from "@fmerp/shared/server/common";
import {
  ApiError,
  type AppRouter,
  type DepsProvider,
  requireSession,
  requireTenant,
} from "@fmerp/shared/server/http";
import { createRoute, z } from "@hono/zod-openapi";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import {
  type DepartmentCsvRow,
  departmentsToCsv,
  planDepartmentImport,
} from "../domain/department-csv";
import { checkCreateDepartment, checkMoveDepartment } from "../domain/department-tree";
import { countInFlightForDepartment } from "../service/in-flight";

const DepartmentSchema = z
  .object({
    id: z.string(),
    businessId: z.string(),
    parentId: z.string().nullable(),
    depth: z.number().int(),
    code: z.string(),
    name: z.string(),
    shortName: z.string().nullable(),
    headMembershipId: z.string().nullable(),
    headName: z.string().nullable(),
    sort: z.number().int(),
    active: z.boolean(),
    validFrom: z.string().nullable(),
    validTo: z.string().nullable(),
    memberCount: z.number().int(),
  })
  .openapi("Department");

const deptCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,20}$/, "부서 코드는 영문·숫자·-·_ 20자 이하여야 합니다");

const dateOnly = z.iso.date().nullable().optional();

const DepartmentInput = z.object({
  businessId: z.uuid(),
  parentId: z.uuid().nullable().optional(),
  code: deptCode,
  name: z.string().trim().min(1).max(100),
  shortName: z.string().trim().max(30).nullable().optional(),
  headMembershipId: z.uuid().nullable().optional(),
  sort: z.number().int().min(0).max(100000).optional(),
  validFrom: dateOnly,
  validTo: dateOnly,
});

type DeptRow = typeof schema.department.$inferSelect;

/** 부서별 유효 소속 인원수와 부서장 이름을 붙여 응답 형태로 만든다 */
async function listDepartments(tx: Tx, businessId?: string) {
  const depts = await tx
    .select()
    .from(schema.department)
    .where(businessId ? eq(schema.department.businessId, businessId) : undefined)
    .orderBy(
      asc(schema.department.depth),
      asc(schema.department.sort),
      asc(schema.department.code),
    );
  const counts = await tx
    .select({ departmentId: schema.assignment.departmentId, n: count() })
    .from(schema.assignment)
    .innerJoin(schema.membership, eq(schema.membership.id, schema.assignment.membershipId))
    .where(and(isNull(schema.assignment.validTo), eq(schema.membership.status, "active")))
    .groupBy(schema.assignment.departmentId);
  const heads = await tx
    .select({ membershipId: schema.membership.id, name: schema.user.name })
    .from(schema.membership)
    .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId));
  const countBy = new Map(counts.map((r) => [r.departmentId, r.n]));
  const nameBy = new Map(heads.map((h) => [h.membershipId, h.name]));
  return depts.map((d) =>
    toDepartment(d, countBy.get(d.id) ?? 0, nameBy.get(d.headMembershipId ?? "") ?? null),
  );
}

function toDepartment(d: DeptRow, memberCount: number, headName: string | null) {
  return {
    id: d.id,
    businessId: d.businessId,
    parentId: d.parentId,
    depth: d.depth,
    code: d.code,
    name: d.name,
    shortName: d.shortName,
    headMembershipId: d.headMembershipId,
    headName,
    sort: d.sort,
    active: d.active,
    validFrom: d.validFrom,
    validTo: d.validTo,
    memberCount,
  };
}

async function loadMaxDepth(tx: Tx): Promise<number> {
  const [a] = await tx.select({ n: schema.account.maxDeptDepth }).from(schema.account);
  if (!a) throw new ApiError(404, "not_found", "회사를 찾을 수 없습니다");
  return a.n;
}

async function loadDepartment(tx: Tx, id: string): Promise<DeptRow> {
  const [d] = await tx.select().from(schema.department).where(eq(schema.department.id, id));
  if (!d) throw new ApiError(404, "not_found", "부서를 찾을 수 없습니다");
  return d;
}

/** 부서 트리·조직도·CSV (PRD ORG-010~016) */
export function registerDepartmentRoutes(app: AppRouter, deps: DepsProvider) {
  for (const prefix of ["/departments", "/org-chart"]) {
    app.use(prefix, requireSession(deps), requireTenant(deps));
    app.use(`${prefix}/*`, requireSession(deps), requireTenant(deps));
  }

  app.openapi(
    createRoute({
      method: "get",
      path: "/departments",
      tags: ["org"],
      summary: "부서 목록 (평면, 뎁스·정렬 순)",
      request: { query: z.object({ businessId: z.uuid().optional() }) },
      responses: { 200: json(z.array(DepartmentSchema)), ...errorResponses },
    }),
    async (c) => {
      const rows = await withTenant(deps().appDb, c.get("tenant").accountId, (tx) =>
        listDepartments(tx, c.req.valid("query").businessId),
      );
      return c.json(rows, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/org-chart",
      tags: ["org"],
      summary: "조직도: 사업자별 부서 트리와 구성원 수 (ORG-016)",
      responses: {
        200: json(
          z.object({
            maxDeptDepth: z.number().int(),
            businesses: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                active: z.boolean(),
                departments: z.array(DepartmentSchema),
              }),
            ),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const result = await withTenant(deps().appDb, c.get("tenant").accountId, async (tx) => {
        const businesses = await tx
          .select()
          .from(schema.business)
          .orderBy(asc(schema.business.createdAt));
        const departments = await listDepartments(tx);
        return {
          maxDeptDepth: await loadMaxDepth(tx),
          businesses: businesses.map((b) => ({
            id: b.id,
            name: b.name,
            active: b.active,
            departments: departments.filter((d) => d.businessId === b.id),
          })),
        };
      });
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/departments",
      tags: ["org"],
      summary: "부서 생성 (뎁스 초과 시 400)",
      request: { body: { content: { "application/json": { schema: DepartmentInput } } } },
      responses: { 201: json(DepartmentSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const input = c.req.valid("json");
      const created = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        const parent = input.parentId ? await loadDepartment(tx, input.parentId) : null;
        if (parent && parent.businessId !== input.businessId) {
          throw new ApiError(400, "validation_error", "다른 사업자의 부서 아래에 만들 수 없습니다");
        }
        authorize(
          actor,
          "department.edit",
          parent
            ? { type: "department", businessId: parent.businessId, departmentPath: parent.path }
            : businessTarget(input.businessId),
        );
        const check = checkCreateDepartment({
          parentDepth: parent?.depth ?? null,
          maxDepth: await loadMaxDepth(tx),
        });
        if (!check.ok) throw new ApiError(400, "depth_exceeded", check.reason);
        const [row] = await tx
          .insert(schema.department)
          .values({
            accountId: tenant.accountId,
            businessId: input.businessId,
            parentId: input.parentId ?? null,
            code: input.code,
            name: input.name,
            shortName: input.shortName,
            headMembershipId: input.headMembershipId,
            sort: input.sort ?? 0,
            validFrom: input.validFrom,
            validTo: input.validTo,
          })
          .returning();
        if (!row) throw new Error("부서 생성 실패");
        await recordAudit(tx, {
          accountId: tenant.accountId,
          actorUserId: c.get("session").userId,
          action: "department.create",
          target: { type: "department", id: row.id, label: row.name },
          diff: computeAuditDiff({}, { code: row.code, name: row.name, depth: row.depth }),
          result: "success",
          request: c.get("request"),
        });
        return toDepartment(row, 0, null);
      });
      return c.json(created, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/departments/{id}",
      tags: ["org"],
      summary: "부서 속성 수정 (이름·코드·약칭·부서장·정렬·유효기간)",
      request: {
        params: z.object({ id: z.uuid() }),
        body: {
          content: {
            "application/json": {
              schema: DepartmentInput.pick({
                code: true,
                name: true,
                shortName: true,
                headMembershipId: true,
                sort: true,
                validFrom: true,
                validTo: true,
              }).partial(),
            },
          },
        },
      },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        authorize(actor, "department.edit", await departmentTarget(tx, id));
        const before = await loadDepartment(tx, id);
        const [row] = await tx
          .update(schema.department)
          .set(patch)
          .where(eq(schema.department.id, id))
          .returning();
        if (!row) throw new Error("부서 수정 실패");
        await recordAudit(tx, {
          accountId: tenant.accountId,
          actorUserId: c.get("session").userId,
          action: "department.update",
          target: { type: "department", id, label: row.name },
          diff: computeAuditDiff(
            {
              code: before.code,
              name: before.name,
              shortName: before.shortName,
              headMembershipId: before.headMembershipId,
              sort: before.sort,
              validFrom: before.validFrom,
              validTo: before.validTo,
            },
            {
              code: row.code,
              name: row.name,
              shortName: row.shortName,
              headMembershipId: row.headMembershipId,
              sort: row.sort,
              validFrom: row.validFrom,
              validTo: row.validTo,
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
      method: "post",
      path: "/departments/{id}/move",
      tags: ["org"],
      summary: "부서 이동 (하위 트리 뎁스 초과·순환·다른 사업자는 거부, ORG-013)",
      request: {
        params: z.object({ id: z.uuid() }),
        body: {
          content: {
            "application/json": { schema: z.object({ newParentId: z.uuid().nullable() }) },
          },
        },
      },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const { newParentId } = c.req.valid("json");
      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        const moving = await loadDepartment(tx, id);
        authorize(actor, "department.edit", await departmentTarget(tx, id));
        if (newParentId) {
          const parent = await loadDepartment(tx, newParentId);
          if (parent.businessId !== moving.businessId) {
            throw new ApiError(400, "validation_error", "다른 사업자로 부서를 옮길 수 없습니다");
          }
          authorize(actor, "department.edit", await departmentTarget(tx, newParentId));
        } else {
          authorize(actor, "department.edit", businessTarget(moving.businessId));
        }
        const nodes = await tx
          .select({
            id: schema.department.id,
            parentId: schema.department.parentId,
            depth: schema.department.depth,
          })
          .from(schema.department)
          .where(eq(schema.department.businessId, moving.businessId));
        const check = checkMoveDepartment({
          nodes,
          id,
          newParentId,
          maxDepth: await loadMaxDepth(tx),
        });
        if (!check.ok) throw new ApiError(400, "depth_exceeded", check.reason);
        await tx
          .update(schema.department)
          .set({ parentId: newParentId })
          .where(eq(schema.department.id, id));
        await recordAudit(tx, {
          accountId: tenant.accountId,
          actorUserId: c.get("session").userId,
          action: "department.move",
          target: { type: "department", id, label: moving.name },
          diff: computeAuditDiff({ parentId: moving.parentId }, { parentId: newParentId }),
          result: "success",
          request: c.get("request"),
        });
      });
      return c.json({ ok: true as const }, 200);
    },
  );

  for (const [path, active] of [
    ["/departments/{id}/deactivate", false],
    ["/departments/{id}/activate", true],
  ] as const) {
    app.openapi(
      createRoute({
        method: "post",
        path,
        tags: ["org"],
        summary: active
          ? "부서 다시 사용"
          : "부서 폐지(비활성). 진행 중 결재선에 있으면 거부 (ORG-015)",
        request: { params: z.object({ id: z.uuid() }) },
        responses: { 200: json(OkSchema), ...errorResponses },
      }),
      async (c) => {
        const d = deps();
        const tenant = c.get("tenant");
        const { id } = c.req.valid("param");
        await withTenant(d.appDb, tenant.accountId, async (tx) => {
          const { actor } = await loadActor(tx, tenant, c.get("session").userId);
          authorize(actor, "department.edit", await departmentTarget(tx, id));
          const before = await loadDepartment(tx, id);
          if (!active && (await countInFlightForDepartment(tx, id)) > 0) {
            throw new ApiError(
              409,
              "in_flight",
              "진행 중인 결재선에 포함된 부서라 폐지할 수 없습니다",
            );
          }
          await tx.update(schema.department).set({ active }).where(eq(schema.department.id, id));
          await recordAudit(tx, {
            accountId: tenant.accountId,
            actorUserId: c.get("session").userId,
            action: active ? "department.activate" : "department.deactivate",
            target: { type: "department", id, label: before.name },
            result: "success",
            request: c.get("request"),
          });
        });
        return c.json({ ok: true as const }, 200);
      },
    );
  }

  app.openapi(
    createRoute({
      method: "delete",
      path: "/departments/{id}",
      tags: ["org"],
      summary: "부서 삭제. 하위 부서·소속원·진행 중 결재선이 있으면 거부(폐지만 가능, ORG-015)",
      request: { params: z.object({ id: z.uuid() }) },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        authorize(actor, "department.edit", await departmentTarget(tx, id));
        const before = await loadDepartment(tx, id);
        const [children] = await tx
          .select({ n: count() })
          .from(schema.department)
          .where(eq(schema.department.parentId, id));
        const [members] = await tx
          .select({ n: count() })
          .from(schema.assignment)
          .where(and(eq(schema.assignment.departmentId, id), isNull(schema.assignment.validTo)));
        if ((children?.n ?? 0) > 0 || (members?.n ?? 0) > 0) {
          throw new ApiError(
            409,
            "in_use",
            "하위 부서나 소속원이 있어 삭제할 수 없습니다. 폐지 처리하세요",
          );
        }
        if ((await countInFlightForDepartment(tx, id)) > 0) {
          throw new ApiError(
            409,
            "in_flight",
            "진행 중인 결재선에 포함된 부서라 삭제할 수 없습니다",
          );
        }
        // 종료된 과거 소속이 남아 있으면 참조 제약(in_use)으로 거부된다
        await tx.delete(schema.department).where(eq(schema.department.id, id));
        await recordAudit(tx, {
          accountId: tenant.accountId,
          actorUserId: c.get("session").userId,
          action: "department.delete",
          target: { type: "department", id, label: before.name },
          result: "success",
          request: c.get("request"),
        });
      });
      return c.json({ ok: true as const }, 200);
    },
  );

  // ===== CSV (ORG-016) =====
  app.openapi(
    createRoute({
      method: "get",
      path: "/departments/export",
      tags: ["org"],
      summary: "부서 CSV 내보내기 (사업자 단위)",
      request: { query: z.object({ businessId: z.uuid() }) },
      responses: {
        200: { description: "CSV", content: { "text/csv": { schema: z.string() } } },
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { businessId } = c.req.valid("query");
      const rows = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        authorize(actor, "department.edit", businessTarget(businessId));
        const list = await tx
          .select()
          .from(schema.department)
          .where(eq(schema.department.businessId, businessId))
          .orderBy(asc(schema.department.depth), asc(schema.department.sort));
        const codeById = new Map(list.map((x) => [x.id, x.code]));
        await recordAudit(tx, {
          accountId: tenant.accountId,
          actorUserId: c.get("session").userId,
          action: "department.export",
          target: { type: "business", id: businessId },
          result: "success",
          request: c.get("request"),
        });
        return list.map(
          (x): DepartmentCsvRow => ({
            code: x.code,
            name: x.name,
            parentCode: x.parentId ? (codeById.get(x.parentId) ?? null) : null,
            shortName: x.shortName,
            sort: x.sort,
          }),
        );
      });
      return c.body(departmentsToCsv(rows), 200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="departments.csv"',
      });
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/departments/import",
      tags: ["org"],
      summary: "부서 CSV 가져오기 (전부 성공하거나 전부 취소. 오류는 줄 번호와 함께 반환)",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({ businessId: z.uuid(), csv: z.string().max(500_000) }),
            },
          },
        },
      },
      responses: { 200: json(z.object({ created: z.number().int() })), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { businessId, csv } = c.req.valid("json");
      const created = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        authorize(actor, "department.edit", businessTarget(businessId));
        const existing = await tx
          .select({
            id: schema.department.id,
            code: schema.department.code,
            depth: schema.department.depth,
          })
          .from(schema.department)
          .where(eq(schema.department.businessId, businessId));
        const plan = planDepartmentImport({ csv, existing, maxDepth: await loadMaxDepth(tx) });
        if (!plan.ok) {
          throw new ApiError(400, "import_invalid", "CSV에 오류가 있어 가져오지 않았습니다", {
            errors: plan.errors,
          });
        }
        const idByCode = new Map(existing.map((e) => [e.code, e.id]));
        for (const row of plan.creates) {
          const [made] = await tx
            .insert(schema.department)
            .values({
              accountId: tenant.accountId,
              businessId,
              parentId: row.parentCode ? idByCode.get(row.parentCode) : null,
              code: row.code,
              name: row.name,
              shortName: row.shortName,
              sort: row.sort,
            })
            .returning({ id: schema.department.id });
          if (made) idByCode.set(row.code, made.id);
        }
        await recordAudit(tx, {
          accountId: tenant.accountId,
          actorUserId: c.get("session").userId,
          action: "department.import",
          target: { type: "business", id: businessId, label: `${plan.creates.length}개 부서` },
          result: "success",
          request: c.get("request"),
        });
        return plan.creates.length;
      });
      return c.json({ created }, 200);
    },
  );
}

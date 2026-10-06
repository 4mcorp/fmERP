import { randomUUID } from "node:crypto";
import { computeAuditDiff, recordAudit } from "@fmerp/audit";
import { schema, withTenant } from "@fmerp/db";
import { ACCOUNT_TARGET, authorize, loadActor } from "@fmerp/shared/authz/org-access";
import {
  isValidBusinessNumber,
  normalizeBusinessNumber,
} from "@fmerp/shared/domain/business-number";
import { type Action, can, canInAnyScope } from "@fmerp/shared/domain/permissions";
import { errorResponses, json, OkSchema } from "@fmerp/shared/server/common";
import {
  ApiError,
  type AppRouter,
  type DepsProvider,
  requireSession,
  requireTenant,
} from "@fmerp/shared/server/http";
import { createRoute, z } from "@hono/zod-openapi";
import { asc, eq } from "drizzle-orm";
import { checkMaxDepthChange } from "../domain/department-tree";
import { countInFlightForBusiness } from "../service/in-flight";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const BusinessSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    bizRegNo: z.string(),
    corpRegNo: z.string().nullable(),
    ceoName: z.string().nullable(),
    industry: z.string().nullable(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    code: z.string(),
    hasSeal: z.boolean(),
    active: z.boolean(),
  })
  .openapi("Business");

const PositionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    rank: z.number().int().optional(),
    active: z.boolean(),
  })
  .openapi("OrgMaster");

const bizCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{1,10}$/, "사업자 코드는 영문 대문자·숫자·-·_ 10자 이하여야 합니다");

const bizRegNo = z
  .string()
  .transform(normalizeBusinessNumber)
  .refine(isValidBusinessNumber, "사업자등록번호가 올바르지 않습니다");

const optionalText = z.string().trim().max(200).nullable().optional();

const BusinessInput = z.object({
  name: z.string().trim().min(1).max(100),
  bizRegNo,
  corpRegNo: optionalText,
  ceoName: optionalText,
  industry: optionalText,
  address: optionalText,
  phone: optionalText,
  code: bizCode,
});

const SecurityPolicyPatch = z
  .object({
    idleTimeoutMinutes: z.number().int().min(5).max(1440),
    absoluteTimeoutHours: z.number().int().min(1).max(72),
    pinRequired: z.boolean(),
    allowAdminExport: z.boolean(),
    attachmentMaxMb: z.number().int().min(1).max(100),
    attachmentExtensions: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9]{1,10}$/),
      )
      .max(50),
  })
  .partial();

const SettingsPatch = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  allowedDomains: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/),
    )
    .max(20)
    .optional(),
  maxDeptDepth: z.number().int().min(1).max(5).optional(),
  securityPolicy: SecurityPolicyPatch.optional(),
});

const SettingsSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    allowedDomains: z.array(z.string()),
    maxDeptDepth: z.number().int(),
    timezone: z.string(),
    locale: z.string(),
    securityPolicy: z.record(z.string(), z.unknown()),
  })
  .openapi("AccountSettings");

/** 계정 설정·사업자·직위·직책 (PRD ORG-001~005, ORG-030·031, ADM-001·002) */
export function registerOrgRoutes(app: AppRouter, deps: DepsProvider) {
  for (const prefix of ["/businesses", "/positions", "/duties"]) {
    app.use(prefix, requireSession(deps), requireTenant(deps));
    app.use(`${prefix}/*`, requireSession(deps), requireTenant(deps));
  }

  // ===== 계정 설정 (ORG-001, ORG-012, ADM-001) =====
  app.openapi(
    createRoute({
      method: "get",
      path: "/account/settings",
      tags: ["account"],
      summary: "계정 설정 조회",
      responses: { 200: json(SettingsSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const row = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        authorize(actor, "account.settings", ACCOUNT_TARGET);
        const [a] = await tx.select().from(schema.account);
        return a;
      });
      if (!row) throw new ApiError(404, "not_found", "회사를 찾을 수 없습니다");
      return c.json(
        {
          id: row.id,
          name: row.name,
          allowedDomains: row.allowedDomains,
          maxDeptDepth: row.maxDeptDepth,
          timezone: row.timezone,
          locale: row.locale,
          securityPolicy: row.securityPolicy as Record<string, unknown>,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/account/settings",
      tags: ["account"],
      summary: "계정 설정 수정 (뎁스를 낮출 때 넘는 부서가 있으면 409)",
      request: { body: { content: { "application/json": { schema: SettingsPatch } } } },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const patch = c.req.valid("json");
      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        authorize(actor, "account.settings", ACCOUNT_TARGET);
        // 계정 관리자에게 내보내기를 허용하는 일은 소유자만 한다 (관리자가 스스로 허용하는 것을 막는다)
        if (patch.securityPolicy?.allowAdminExport !== undefined && tenant.role !== "owner") {
          throw new ApiError(403, "forbidden", "내보내기 허용 설정은 소유자만 바꿀 수 있습니다");
        }
        const [before] = await tx.select().from(schema.account);
        if (!before) throw new ApiError(404, "not_found", "회사를 찾을 수 없습니다");

        if (patch.maxDeptDepth !== undefined && patch.maxDeptDepth < before.maxDeptDepth) {
          const depts = await tx
            .select({
              id: schema.department.id,
              name: schema.department.name,
              depth: schema.department.depth,
              parentId: schema.department.parentId,
            })
            .from(schema.department);
          const check = checkMaxDepthChange(depts, patch.maxDeptDepth);
          if (!check.ok) {
            const exceeding = depts.filter((x) => check.exceeding.includes(x.id));
            throw new ApiError(
              409,
              "depth_exceeded",
              `${patch.maxDeptDepth}단계를 넘는 부서가 ${exceeding.length}개 있어 줄일 수 없습니다`,
              { departments: exceeding.map((x) => ({ id: x.id, name: x.name, depth: x.depth })) },
            );
          }
        }

        const next = {
          name: patch.name ?? before.name,
          allowedDomains: patch.allowedDomains ?? before.allowedDomains,
          maxDeptDepth: patch.maxDeptDepth ?? before.maxDeptDepth,
          securityPolicy: { ...before.securityPolicy, ...patch.securityPolicy },
        };
        await tx.update(schema.account).set(next).where(eq(schema.account.id, tenant.accountId));
        await recordAudit(tx, {
          accountId: tenant.accountId,
          actorUserId: c.get("session").userId,
          action: "account.settings_update",
          target: { type: "account", id: tenant.accountId, label: next.name },
          diff: computeAuditDiff(
            {
              name: before.name,
              allowedDomains: before.allowedDomains,
              maxDeptDepth: before.maxDeptDepth,
              securityPolicy: before.securityPolicy,
            },
            next,
          ),
          result: "success",
          request: c.get("request"),
        });
      });
      return c.json({ ok: true as const }, 200);
    },
  );

  // ===== 사업자 (ORG-002~005) =====
  const toBusiness = (b: typeof schema.business.$inferSelect) => ({
    id: b.id,
    name: b.name,
    bizRegNo: b.bizRegNo,
    corpRegNo: b.corpRegNo,
    ceoName: b.ceoName,
    industry: b.industry,
    address: b.address,
    phone: b.phone,
    code: b.code,
    hasSeal: Boolean(b.sealKey),
    active: b.active,
  });

  app.openapi(
    createRoute({
      method: "get",
      path: "/businesses",
      tags: ["org"],
      summary: "사업자 목록",
      responses: { 200: json(z.array(BusinessSchema)), ...errorResponses },
    }),
    async (c) => {
      const rows = await withTenant(deps().appDb, c.get("tenant").accountId, (tx) =>
        tx.select().from(schema.business).orderBy(asc(schema.business.createdAt)),
      );
      return c.json(rows.map(toBusiness), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/businesses",
      tags: ["org"],
      summary: "사업자 등록 (등록번호 체크섬·중복 검증)",
      request: { body: { content: { "application/json": { schema: BusinessInput } } } },
      responses: { 201: json(BusinessSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const input = c.req.valid("json");
      const created = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        authorize(actor, "business.create", ACCOUNT_TARGET);
        const [row] = await tx
          .insert(schema.business)
          .values({ accountId: tenant.accountId, ...input })
          .returning();
        if (!row) throw new Error("사업자 생성 실패");
        await recordAudit(tx, {
          accountId: tenant.accountId,
          actorUserId: c.get("session").userId,
          action: "business.create",
          target: { type: "business", id: row.id, label: row.name },
          diff: computeAuditDiff({}, { name: row.name, code: row.code, bizRegNo: row.bizRegNo }),
          result: "success",
          request: c.get("request"),
        });
        return row;
      });
      return c.json(toBusiness(created), 201);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/businesses/{id}",
      tags: ["org"],
      summary: "사업자 정보 수정",
      request: {
        params: z.object({ id: z.uuid() }),
        body: { content: { "application/json": { schema: BusinessInput.partial() } } },
      },
      responses: { 200: json(BusinessSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      const updated = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        authorize(actor, "business.create", ACCOUNT_TARGET);
        const [before] = await tx.select().from(schema.business).where(eq(schema.business.id, id));
        if (!before) throw new ApiError(404, "not_found", "사업자를 찾을 수 없습니다");
        const [row] = await tx
          .update(schema.business)
          .set(patch)
          .where(eq(schema.business.id, id))
          .returning();
        if (!row) throw new Error("사업자 수정 실패");
        await recordAudit(tx, {
          accountId: tenant.accountId,
          actorUserId: c.get("session").userId,
          action: "business.update",
          target: { type: "business", id, label: row.name },
          diff: computeAuditDiff(toBusiness(before), toBusiness(row)),
          result: "success",
          request: c.get("request"),
        });
        return row;
      });
      return c.json(toBusiness(updated), 200);
    },
  );

  for (const [path, active] of [
    ["/businesses/{id}/deactivate", false],
    ["/businesses/{id}/activate", true],
  ] as const) {
    app.openapi(
      createRoute({
        method: "post",
        path,
        tags: ["org"],
        summary: active
          ? "사업자 다시 사용"
          : "사업자 비활성화 (진행 중 결재가 있으면 거부, ORG-005)",
        request: { params: z.object({ id: z.uuid() }) },
        responses: { 200: json(OkSchema), ...errorResponses },
      }),
      async (c) => {
        const d = deps();
        const tenant = c.get("tenant");
        const { id } = c.req.valid("param");
        await withTenant(d.appDb, tenant.accountId, async (tx) => {
          const { actor } = await loadActor(tx, tenant, c.get("session").userId);
          authorize(actor, "business.create", ACCOUNT_TARGET);
          if (!active && (await countInFlightForBusiness(tx, id)) > 0) {
            throw new ApiError(409, "in_flight", "진행 중인 결재가 있어 비활성화할 수 없습니다");
          }
          const rows = await tx
            .update(schema.business)
            .set({ active })
            .where(eq(schema.business.id, id))
            .returning({ id: schema.business.id, name: schema.business.name });
          const row = rows[0];
          if (!row) throw new ApiError(404, "not_found", "사업자를 찾을 수 없습니다");
          await recordAudit(tx, {
            accountId: tenant.accountId,
            actorUserId: c.get("session").userId,
            action: active ? "business.activate" : "business.deactivate",
            target: { type: "business", id, label: row.name },
            result: "success",
            request: c.get("request"),
          });
        });
        return c.json({ ok: true as const }, 200);
      },
    );
  }

  // 직인 이미지 (ORG-003): 브라우저가 서명 URL로 저장소에 직접 올린다
  const sealPrefix = (accountId: string, businessId: string) =>
    `accounts/${accountId}/businesses/${businessId}/seal/`;

  app.openapi(
    createRoute({
      method: "post",
      path: "/businesses/{id}/seal/upload-url",
      tags: ["org"],
      summary: "직인 이미지 업로드용 서명 URL 발급",
      request: {
        params: z.object({ id: z.uuid() }),
        body: {
          content: {
            "application/json": { schema: z.object({ contentType: z.enum(IMAGE_TYPES) }) },
          },
        },
      },
      responses: {
        200: json(z.object({ uploadUrl: z.string(), key: z.string() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        authorize(actor, "business.create", ACCOUNT_TARGET);
        const [b] = await tx
          .select({ id: schema.business.id })
          .from(schema.business)
          .where(eq(schema.business.id, id));
        if (!b) throw new ApiError(404, "not_found", "사업자를 찾을 수 없습니다");
      });
      const key = `${sealPrefix(tenant.accountId, id)}${randomUUID()}`;
      const uploadUrl = await d.storage.presignPut(key, c.req.valid("json").contentType);
      return c.json({ uploadUrl, key }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/businesses/{id}/seal",
      tags: ["org"],
      summary: "업로드한 이미지를 사업자 직인으로 등록",
      request: {
        params: z.object({ id: z.uuid() }),
        body: { content: { "application/json": { schema: z.object({ key: z.string() }) } } },
      },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const { key } = c.req.valid("json");
      if (!key.startsWith(sealPrefix(tenant.accountId, id))) {
        throw new ApiError(403, "forbidden", "이 사업자의 이미지만 등록할 수 있습니다");
      }
      const info = await d.storage.head(key);
      if (!info) throw new ApiError(400, "validation_error", "업로드된 파일이 없습니다");
      if (!IMAGE_TYPES.includes(info.contentType as (typeof IMAGE_TYPES)[number])) {
        throw new ApiError(400, "validation_error", "PNG·JPEG·WebP 이미지만 등록할 수 있습니다");
      }
      if (info.size > MAX_IMAGE_BYTES) {
        throw new ApiError(400, "validation_error", "이미지는 2MB 이하여야 합니다");
      }
      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        authorize(actor, "business.create", ACCOUNT_TARGET);
        const rows = await tx
          .update(schema.business)
          .set({ sealKey: key })
          .where(eq(schema.business.id, id))
          .returning({ name: schema.business.name });
        const row = rows[0];
        if (!row) throw new ApiError(404, "not_found", "사업자를 찾을 수 없습니다");
        await recordAudit(tx, {
          accountId: tenant.accountId,
          actorUserId: c.get("session").userId,
          action: "business.seal_update",
          target: { type: "business", id, label: row.name },
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
      path: "/businesses/{id}/seal",
      tags: ["org"],
      summary: "직인 이미지 보기용 서명 URL",
      request: { params: z.object({ id: z.uuid() }) },
      responses: { 200: json(z.object({ url: z.string() })), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const { id } = c.req.valid("param");
      const [row] = await withTenant(d.appDb, c.get("tenant").accountId, (tx) =>
        tx
          .select({ sealKey: schema.business.sealKey })
          .from(schema.business)
          .where(eq(schema.business.id, id)),
      );
      if (!row?.sealKey) throw new ApiError(404, "not_found", "등록된 직인이 없습니다");
      return c.json({ url: await d.storage.presignGet(row.sealKey) }, 200);
    },
  );

  // ===== 직위·직책 마스터 (ORG-030·031) =====
  const masters = [
    { path: "/positions", table: schema.position, kind: "position", withRank: true },
    { path: "/duties", table: schema.duty, kind: "duty", withRank: false },
  ] as const;

  for (const m of masters) {
    const label = m.kind === "position" ? "직위" : "직책";
    const Input = z.object({
      name: z.string().trim().min(1).max(50),
      ...(m.withRank ? { rank: z.number().int().min(0).max(10000) } : {}),
    });

    app.openapi(
      createRoute({
        method: "get",
        path: m.path,
        tags: ["org"],
        summary: `${label} 목록`,
        responses: { 200: json(z.array(PositionSchema)), ...errorResponses },
      }),
      async (c) => {
        const rows = await withTenant(deps().appDb, c.get("tenant").accountId, (tx) =>
          m.kind === "position"
            ? tx.select().from(schema.position).orderBy(asc(schema.position.rank))
            : tx.select().from(schema.duty).orderBy(asc(schema.duty.name)),
        );
        return c.json(
          rows.map((r) => ({
            id: r.id,
            name: r.name,
            rank: (r as { rank?: number }).rank,
            active: r.active,
          })),
          200,
        );
      },
    );

    app.openapi(
      createRoute({
        method: "post",
        path: m.path,
        tags: ["org"],
        summary: `${label} 추가`,
        request: { body: { content: { "application/json": { schema: Input } } } },
        responses: { 201: json(PositionSchema), ...errorResponses },
      }),
      async (c) => {
        const d = deps();
        const tenant = c.get("tenant");
        const input = c.req.valid("json") as { name: string; rank?: number };
        const row = await withTenant(d.appDb, tenant.accountId, async (tx) => {
          const { actor } = await loadActor(tx, tenant, c.get("session").userId);
          authorize(actor, "position.manage", ACCOUNT_TARGET);
          const [created] =
            m.kind === "position"
              ? await tx
                  .insert(schema.position)
                  .values({ accountId: tenant.accountId, name: input.name, rank: input.rank ?? 0 })
                  .returning()
              : await tx
                  .insert(schema.duty)
                  .values({ accountId: tenant.accountId, name: input.name })
                  .returning();
          if (!created) throw new Error(`${label} 생성 실패`);
          await recordAudit(tx, {
            accountId: tenant.accountId,
            actorUserId: c.get("session").userId,
            action: `${m.kind}.create`,
            target: { type: m.kind, id: created.id, label: created.name },
            result: "success",
            request: c.get("request"),
          });
          return created;
        });
        return c.json(
          {
            id: row.id,
            name: row.name,
            rank: (row as { rank?: number }).rank,
            active: row.active,
          },
          201,
        );
      },
    );

    app.openapi(
      createRoute({
        method: "patch",
        path: `${m.path}/{id}`,
        tags: ["org"],
        summary: `${label} 수정·사용 여부 변경`,
        request: {
          params: z.object({ id: z.uuid() }),
          body: {
            content: {
              "application/json": {
                schema: Input.partial().extend({ active: z.boolean().optional() }),
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
        const patch = c.req.valid("json") as { name?: string; rank?: number; active?: boolean };
        await withTenant(d.appDb, tenant.accountId, async (tx) => {
          const { actor } = await loadActor(tx, tenant, c.get("session").userId);
          authorize(actor, "position.manage", ACCOUNT_TARGET);
          const set = {
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.active !== undefined ? { active: patch.active } : {}),
          };
          if (Object.keys(set).length === 0 && patch.rank === undefined) {
            throw new ApiError(400, "validation_error", "변경할 값이 없습니다");
          }
          const rows =
            m.kind === "position"
              ? await tx
                  .update(schema.position)
                  .set({ ...set, ...(patch.rank !== undefined ? { rank: patch.rank } : {}) })
                  .where(eq(schema.position.id, id))
                  .returning({ id: schema.position.id })
              : await tx
                  .update(schema.duty)
                  .set(set)
                  .where(eq(schema.duty.id, id))
                  .returning({ id: schema.duty.id });
          if (rows.length === 0)
            throw new ApiError(404, "not_found", `${label}을(를) 찾을 수 없습니다`);
          await recordAudit(tx, {
            accountId: tenant.accountId,
            actorUserId: c.get("session").userId,
            action: `${m.kind}.update`,
            target: { type: m.kind, id },
            diff: computeAuditDiff({}, patch as Record<string, unknown>),
            result: "success",
            request: c.get("request"),
          });
        });
        return c.json({ ok: true as const }, 200);
      },
    );
  }

  // 메뉴 노출용: 내가 어떤 관리 기능을 쓸 수 있는지 (실제 실행은 대상 범위로 서버가 다시 판정한다)
  app.openapi(
    createRoute({
      method: "get",
      path: "/account/capabilities",
      tags: ["account"],
      summary: "내 관리 권한 요약 (메뉴 노출용)",
      responses: { 200: json(z.record(z.string(), z.boolean())), ...errorResponses },
    }),
    async (c) => {
      const tenant = c.get("tenant");
      const actions: Action[] = [
        "account.settings",
        "business.create",
        "role.grant",
        "department.edit",
        "member.invite",
        "member.deactivate",
        "assignment.manage",
        "position.manage",
        "audit.read",
        "document.read_all",
        "form.manage",
        "approval.manage",
        "delegation.manage",
      ];
      const result = await withTenant(deps().appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        const caps = Object.fromEntries(actions.map((a) => [a, canInAnyScope(actor, a)]));
        // 감사 로그 조회·월간 점검은 계정 범위 감사 권한자만 쓴다. 부서·사업자 범위 감사인은 문서 이력만 본다
        // 계정 전체 내보내기: 소유자, 또는 소유자가 허용한 계정 관리자 (PRD 3.3 각주 2)
        const [acct] = await tx
          .select({ policy: schema.account.securityPolicy })
          .from(schema.account);
        const exportAllowed =
          tenant.role === "owner" ||
          (tenant.role === "admin" && acct?.policy.allowAdminExport === true);
        return {
          ...caps,
          "audit.log": can(actor, "audit.read", ACCOUNT_TARGET),
          "account.export": exportAllowed,
        };
      });
      return c.json(result, 200);
    },
  );
}

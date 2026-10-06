import { can, type DraftLineItem, type FormSchema } from "@fmerp/core";
import { schema, withTenant } from "@fmerp/db";
import {
  ACCOUNT_TARGET,
  authorize,
  businessTarget,
  loadActor,
} from "@fmerp/shared/authz/org-access";
import { errorResponses, json, OkSchema } from "@fmerp/shared/server/common";
import { ServiceError } from "@fmerp/shared/server/errors";
import {
  ApiError,
  type AppRouter,
  type DepsProvider,
  requireSession,
  requireTenant,
} from "@fmerp/shared/server/http";
import { serviceContext } from "@fmerp/shared/server/service-context";
import { createRoute, z } from "@hono/zod-openapi";
import { and, eq, isNull, or } from "drizzle-orm";
import {
  createForm,
  duplicateForm,
  exportForm,
  type FormExport,
  type FormVersionInput,
  formUsableBy,
  getForm,
  importForm,
  latestVersion,
  listForms,
  loadPrefs,
  publishVersion,
  setFormActive,
  touchFormPref,
  versionToInput,
} from "../approval/forms";
import { LineItem } from "./approvals";

const base = {
  key: z.string().max(40),
  label: z.string().max(100),
  required: z.boolean().optional(),
  help: z.string().max(300).optional(),
};
const optInt = z.number().int().min(0).max(1_000_000).optional();
const optNum = z.number().finite().optional();
const Option = z.object({ value: z.string().min(1).max(100), label: z.string().max(100) });

const FieldSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.enum(["text", "textarea"]),
    minLength: optInt,
    maxLength: optInt,
    pattern: z.string().max(200).optional(),
    default: z.string().max(1000).optional(),
  }),
  z.object({
    ...base,
    type: z.literal("number"),
    min: optNum,
    max: optNum,
    integer: z.boolean().optional(),
    default: optNum,
  }),
  z.object({
    ...base,
    type: z.literal("money"),
    min: optNum,
    max: optNum,
    default: optNum,
    searchAmount: z.boolean().optional(),
  }),
  z.object({ ...base, type: z.enum(["date", "daterange"]) }),
  z.object({
    ...base,
    type: z.enum(["select", "multiselect"]),
    options: z.array(Option).max(100),
    default: z.union([z.string(), z.array(z.string())]).optional(),
  }),
  z.object({ ...base, type: z.enum(["user", "dept"]), multiple: z.boolean().optional() }),
  z.object({
    ...base,
    type: z.literal("table"),
    columns: z
      .array(
        z.object({
          key: z.string().max(40),
          label: z.string().max(100),
          type: z.enum(["text", "number", "money", "date"]),
          required: z.boolean().optional(),
          sum: z.boolean().optional(),
        }),
      )
      .max(30),
    minRows: optInt,
    maxRows: optInt,
  }),
  z.object({ ...base, type: z.literal("richtext") }),
  z.object({ ...base, type: z.literal("attachment"), maxFiles: optInt }),
]);

const VersionInput = z.object({
  schema: z.object({ fields: z.array(FieldSchema).max(100) }),
  layout: z.record(z.string(), z.unknown()).optional(),
  defaultLine: z.array(LineItem).max(30),
  numbering: z
    .object({
      rule: z.string().min(1).max(100),
      cycle: z.enum(["year", "month", "none"]),
      at: z.enum(["submit", "complete"]),
    })
    .nullable(),
  retentionYears: z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(5), z.literal(10)]),
  securityDefault: z.enum(["normal", "confidential", "secret"]),
  recipients: z.record(z.string(), z.unknown()).optional(),
  allowLineEdit: z.boolean(),
  policy: z.object({
    disagree: z.enum(["reject", "comment"]),
    rejectTo: z.enum(["drafter", "previous"]),
    auditCanReject: z.boolean(),
  }),
});

const Meta = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,30}$/, "양식 코드는 영문·숫자·-·_ 30자 이하여야 합니다"),
  name: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(50).default("일반"),
  scope: z
    .object({
      businessIds: z.array(z.uuid()).max(50).optional(),
      departmentIds: z.array(z.uuid()).max(200).optional(),
    })
    .optional(),
});

const toInput = (v: z.infer<typeof VersionInput>) => v as unknown as FormVersionInput;

/** 양식 관리와 사용 (PRD APV-001·003~006·010, ADM-004) */
export function registerFormRoutes(app: AppRouter, deps: DepsProvider) {
  for (const prefix of ["/forms", "/approval-line-templates"]) {
    app.use(prefix, requireSession(deps), requireTenant(deps));
    app.use(`${prefix}/*`, requireSession(deps), requireTenant(deps));
  }

  /** 양식 관리 권한: 계정 범위 권한이거나, 사용 범위가 지정된 사업자 모두에 대한 권한 */
  const authorizeForm = (
    actor: Parameters<typeof can>[0],
    scope: { businessIds?: string[] } | undefined,
  ) => {
    if (can(actor, "form.manage", ACCOUNT_TARGET)) return;
    const ids = scope?.businessIds ?? [];
    if (ids.length === 0 || !ids.every((id) => can(actor, "form.manage", businessTarget(id)))) {
      throw new ApiError(403, "forbidden", "권한이 없습니다");
    }
  };

  const FormSummary = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    category: z.string(),
    active: z.boolean(),
    scope: z.record(z.string(), z.unknown()),
    version: z.number().int(),
    versionId: z.string(),
    retentionYears: z.number().int(),
    allowLineEdit: z.boolean(),
    favorite: z.boolean(),
    lastUsedAt: z.string().nullable(),
  });

  app.openapi(
    createRoute({
      method: "get",
      path: "/forms",
      tags: ["forms"],
      summary: "양식 목록 (기안: 내가 쓸 수 있는 양식, 관리: all=true)",
      request: { query: z.object({ all: z.enum(["true", "false"]).optional() }) },
      responses: { 200: json(z.array(FormSummary)), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const wantAll = c.req.valid("query").all === "true";
      const rows = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor, membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        if (
          wantAll &&
          !actor.grants.some((g) => ["business_admin", "approval_admin"].includes(g.role)) &&
          !can(actor, "form.manage", ACCOUNT_TARGET)
        ) {
          throw new ApiError(403, "forbidden", "권한이 없습니다");
        }
        const list = await listForms(tx, { includeInactive: wantAll });
        const prefs = new Map((await loadPrefs(tx, membershipId)).map((p) => [p.formId, p]));
        const mine = await tx
          .select({
            businessId: schema.assignment.businessId,
            departmentId: schema.assignment.departmentId,
          })
          .from(schema.assignment)
          .where(
            and(
              eq(schema.assignment.membershipId, membershipId),
              isNull(schema.assignment.validTo),
            ),
          );
        const who = {
          businessIds: mine.map((m) => m.businessId),
          departmentIds: mine.map((m) => m.departmentId),
        };
        return list
          .filter(({ form }) => wantAll || formUsableBy(form, who))
          .map(({ form, latest }) => ({
            id: form.id,
            code: form.code,
            name: form.name,
            category: form.category,
            active: form.active,
            scope: form.scope as Record<string, unknown>,
            version: latest.version,
            versionId: latest.id,
            retentionYears: latest.retentionYears,
            allowLineEdit: latest.allowLineEdit,
            favorite: prefs.get(form.id)?.favorite ?? false,
            lastUsedAt: prefs.get(form.id)?.lastUsedAt?.toISOString() ?? null,
          }));
      });
      return c.json(rows, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/forms/{id}",
      tags: ["forms"],
      summary: "양식 상세(최신 버전의 필드·결재선·정책)",
      request: { params: z.object({ id: z.uuid() }) },
      responses: {
        200: json(
          z.object({
            id: z.string(),
            code: z.string(),
            name: z.string(),
            category: z.string(),
            active: z.boolean(),
            scope: z.record(z.string(), z.unknown()),
            version: z.number().int(),
            versionId: z.string(),
            definition: z.record(z.string(), z.unknown()),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const out = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const form = await getForm(tx, id);
        const v = await latestVersion(tx, id);
        return {
          id: form.id,
          code: form.code,
          name: form.name,
          category: form.category,
          active: form.active,
          scope: form.scope as Record<string, unknown>,
          version: v.version,
          versionId: v.id,
          definition: versionToInput(v) as unknown as Record<string, unknown>,
        };
      });
      return c.json(out, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/forms",
      tags: ["forms"],
      summary: "양식 만들기 (첫 버전)",
      request: {
        body: {
          content: { "application/json": { schema: Meta.extend({ version: VersionInput }) } },
        },
      },
      responses: {
        201: json(
          z.object({ formId: z.string(), versionId: z.string(), version: z.number().int() }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { version, ...meta } = c.req.valid("json");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        authorizeForm(actor, meta.scope);
        return createForm(serviceContext(c, deps(), tx), meta, toInput(version));
      });
      return c.json(result, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/forms/{id}/versions",
      tags: ["forms"],
      summary: "양식 수정 = 새 버전 (이미 작성된 문서는 작성 당시 버전을 따른다)",
      request: {
        params: z.object({ id: z.uuid() }),
        body: {
          content: {
            "application/json": {
              schema: z.object({
                version: VersionInput,
                name: z.string().trim().min(1).max(100).optional(),
                category: z.string().trim().min(1).max(50).optional(),
                scope: Meta.shape.scope,
              }),
            },
          },
        },
      },
      responses: {
        201: json(z.object({ versionId: z.string(), version: z.number().int() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const { version, ...meta } = c.req.valid("json");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        const form = await getForm(tx, id);
        authorizeForm(actor, form.scope);
        if (meta.scope) authorizeForm(actor, meta.scope);
        return publishVersion(serviceContext(c, deps(), tx), id, toInput(version), meta);
      });
      return c.json(result, 201);
    },
  );

  for (const [path, active] of [
    ["/forms/{id}/deactivate", false],
    ["/forms/{id}/activate", true],
  ] as const) {
    app.openapi(
      createRoute({
        method: "post",
        path,
        tags: ["forms"],
        summary: active ? "양식 다시 사용" : "양식 사용 중지 (기존 문서는 그대로)",
        request: { params: z.object({ id: z.uuid() }) },
        responses: { 200: json(OkSchema), ...errorResponses },
      }),
      async (c) => {
        const d = deps();
        const tenant = c.get("tenant");
        const { id } = c.req.valid("param");
        await withTenant(d.appDb, tenant.accountId, async (tx) => {
          const { actor } = await loadActor(tx, tenant, c.get("session").userId);
          authorizeForm(actor, (await getForm(tx, id)).scope);
          await setFormActive(serviceContext(c, deps(), tx), id, active);
        });
        return c.json({ ok: true as const }, 200);
      },
    );
  }

  app.openapi(
    createRoute({
      method: "post",
      path: "/forms/{id}/duplicate",
      tags: ["forms"],
      summary: "양식 복제",
      request: {
        params: z.object({ id: z.uuid() }),
        body: {
          content: {
            "application/json": {
              schema: z.object({ code: Meta.shape.code, name: Meta.shape.name }),
            },
          },
        },
      },
      responses: { 201: json(z.object({ formId: z.string() })), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        authorizeForm(actor, (await getForm(tx, id)).scope);
        return duplicateForm(serviceContext(c, deps(), tx), id, body);
      });
      return c.json({ formId: result.formId }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/forms/{id}/export",
      tags: ["forms"],
      summary: "양식 JSON 내보내기",
      request: { params: z.object({ id: z.uuid() }) },
      responses: { 200: json(z.record(z.string(), z.unknown())), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const data = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        authorizeForm(actor, (await getForm(tx, id)).scope);
        return exportForm(tx, id);
      });
      return c.json(data as unknown as Record<string, unknown>, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/forms/import",
      tags: ["forms"],
      summary: "양식 JSON 가져오기 (새 양식으로 등록)",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({
                data: z.object({
                  format: z.literal("fmerp-form/1"),
                  code: Meta.shape.code,
                  name: Meta.shape.name,
                  category: Meta.shape.category,
                  version: VersionInput,
                }),
                code: Meta.shape.code.optional(),
                name: Meta.shape.name.optional(),
              }),
            },
          },
        },
      },
      responses: { 201: json(z.object({ formId: z.string() })), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { data, code, name } = c.req.valid("json");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor } = await loadActor(tx, tenant, c.get("session").userId);
        authorizeForm(actor, undefined);
        return importForm(serviceContext(c, deps(), tx), data as unknown as FormExport, {
          code,
          name,
        });
      });
      return c.json({ formId: result.formId }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/forms/{id}/favorite",
      tags: ["forms"],
      summary: "즐겨찾기 설정 (APV-010)",
      request: {
        params: z.object({ id: z.uuid() }),
        body: { content: { "application/json": { schema: z.object({ favorite: z.boolean() }) } } },
      },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        await getForm(tx, id);
        await touchFormPref(serviceContext(c, deps(), tx), membershipId, id, {
          favorite: c.req.valid("json").favorite,
        });
      });
      return c.json({ ok: true as const }, 200);
    },
  );

  // ===== 결재선 템플릿 (APV-033) =====
  const TemplateSchema = z.object({
    id: z.string(),
    formId: z.string().nullable(),
    name: z.string(),
    shared: z.boolean(),
    items: z.array(z.record(z.string(), z.unknown())),
  });

  app.openapi(
    createRoute({
      method: "get",
      path: "/approval-line-templates",
      tags: ["forms"],
      summary: "결재선 템플릿 (공용 + 내 즐겨찾기)",
      request: { query: z.object({ formId: z.uuid().optional() }) },
      responses: { 200: json(z.array(TemplateSchema)), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { formId } = c.req.valid("query");
      const rows = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return tx
          .select()
          .from(schema.approvalLineTemplate)
          .where(
            and(
              or(
                isNull(schema.approvalLineTemplate.ownerMembershipId),
                eq(schema.approvalLineTemplate.ownerMembershipId, membershipId),
              ),
              formId ? eq(schema.approvalLineTemplate.formId, formId) : undefined,
            ),
          );
      });
      return c.json(
        rows.map((r) => ({
          id: r.id,
          formId: r.formId,
          name: r.name,
          shared: r.ownerMembershipId === null,
          items: r.items,
        })),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/approval-line-templates",
      tags: ["forms"],
      summary: "결재선 템플릿 저장 (shared=true는 양식 관리 권한 필요)",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({
                name: z.string().trim().min(1).max(100),
                formId: z.uuid().optional(),
                shared: z.boolean().default(false),
                items: z.array(LineItem).min(1).max(30),
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
      const body = c.req.valid("json");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor, membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        if (body.shared) authorize(actor, "form.manage", ACCOUNT_TARGET);
        // 개인 템플릿에는 전결 권한을 둘 수 없다 (전결은 양식이 정한다)
        const items = (body.items as DraftLineItem[]).map((i) =>
          body.shared ? i : { ...i, canFinalize: false },
        );
        const [row] = await tx
          .insert(schema.approvalLineTemplate)
          .values({
            accountId: tenant.accountId,
            formId: body.formId,
            ownerMembershipId: body.shared ? null : membershipId,
            name: body.name,
            items: items as unknown as Record<string, unknown>[],
          })
          .returning({ id: schema.approvalLineTemplate.id });
        if (!row) throw new Error("템플릿 저장 실패");
        return row;
      });
      return c.json(result, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/approval-line-templates/{id}",
      tags: ["forms"],
      summary: "결재선 템플릿 삭제 (본인 것 또는 공용은 양식 관리 권한)",
      request: { params: z.object({ id: z.uuid() }) },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor, membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        const [row] = await tx
          .select()
          .from(schema.approvalLineTemplate)
          .where(eq(schema.approvalLineTemplate.id, id));
        if (!row) throw new ServiceError("not_found", "템플릿을 찾을 수 없습니다");
        if (row.ownerMembershipId === null) authorize(actor, "form.manage", ACCOUNT_TARGET);
        else if (row.ownerMembershipId !== membershipId)
          throw new ServiceError("not_found", "템플릿을 찾을 수 없습니다");
        await tx.delete(schema.approvalLineTemplate).where(eq(schema.approvalLineTemplate.id, id));
      });
      return c.json({ ok: true as const }, 200);
    },
  );
}

export type { FormSchema };

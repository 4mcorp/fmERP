// 양식 서비스 (PRD APV-001·003~006, ADM-004). 양식 버전은 불변이고 수정은 새 버전이다 (ADR 0008).
import { recordAudit } from "@fmerp/audit";
import { schema, type Tx } from "@fmerp/db";
import { validateDocNumberRule } from "@fmerp/shared/domain/doc-number";
import { type FormSchema, validateFormSchema } from "@fmerp/shared/domain/form-schema";
import type { ServiceContext } from "@fmerp/shared/server/context";
import { ServiceError } from "@fmerp/shared/server/errors";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { DraftLineItem } from "../domain/approval-line";
import type { ApprovalPolicy } from "../domain/approval-types";

export interface FormNumbering {
  rule: string;
  cycle: "year" | "month" | "none";
  at: "submit" | "complete";
}

export interface FormVersionInput {
  schema: FormSchema;
  layout?: Record<string, unknown>;
  defaultLine: DraftLineItem[];
  numbering: FormNumbering | null;
  retentionYears: 0 | 1 | 3 | 5 | 10;
  securityDefault: "normal" | "confidential" | "secret";
  recipients?: Record<string, unknown>;
  allowLineEdit: boolean;
  policy: ApprovalPolicy;
}

export interface FormMeta {
  code: string;
  name: string;
  category: string;
  scope?: { businessIds?: string[]; departmentIds?: string[] };
}

const RETENTION_YEARS = [0, 1, 3, 5, 10] as const;

type FormRow = typeof schema.form.$inferSelect;
type VersionRow = typeof schema.formVersion.$inferSelect;

function validateVersion(input: FormVersionInput) {
  const check = validateFormSchema(input.schema);
  if (!check.ok)
    throw new ServiceError("form_invalid", "양식 필드가 올바르지 않습니다", {
      errors: check.errors,
    });
  if (input.numbering) {
    const n = validateDocNumberRule(input.numbering.rule);
    if (!n.ok) throw new ServiceError("form_invalid", n.reason);
  }
  if (!RETENTION_YEARS.includes(input.retentionYears)) {
    throw new ServiceError("form_invalid", "보존연한은 1·3·5·10년 또는 영구여야 합니다");
  }
  if (input.defaultLine.length > 30)
    throw new ServiceError("form_invalid", "기본 결재선은 30단계까지입니다");
  if (!input.allowLineEdit && input.defaultLine.every((i) => i.type === "post")) {
    throw new ServiceError(
      "form_invalid",
      "결재선 수정을 막으려면 결재 단계가 있는 기본 결재선이 필요합니다",
    );
  }
  if (!input.allowLineEdit && input.defaultLine.length === 0) {
    throw new ServiceError("form_invalid", "결재선 수정을 막으려면 기본 결재선이 필요합니다");
  }
}

const versionValues = (
  accountId: string,
  formId: string,
  version: number,
  input: FormVersionInput,
  createdBy: string | null,
) => ({
  accountId,
  formId,
  version,
  schema: input.schema as unknown as Record<string, unknown>,
  layout: input.layout ?? {},
  defaultLine: input.defaultLine as unknown as Record<string, unknown>[],
  numbering: input.numbering as unknown as Record<string, unknown> | null,
  retentionYears: input.retentionYears,
  securityDefault: input.securityDefault,
  recipients: input.recipients ?? {},
  allowLineEdit: input.allowLineEdit,
  policy: input.policy as unknown as Record<string, unknown>,
  createdBy,
});

export async function getFormVersion(tx: Tx, versionId: string): Promise<VersionRow> {
  const [row] = await tx
    .select()
    .from(schema.formVersion)
    .where(eq(schema.formVersion.id, versionId));
  if (!row) throw new ServiceError("not_found", "양식 버전을 찾을 수 없습니다");
  return row;
}

export async function latestVersion(tx: Tx, formId: string): Promise<VersionRow> {
  const [row] = await tx
    .select()
    .from(schema.formVersion)
    .where(eq(schema.formVersion.formId, formId))
    .orderBy(desc(schema.formVersion.version))
    .limit(1);
  if (!row) throw new ServiceError("not_found", "양식을 찾을 수 없습니다");
  return row;
}

export async function getForm(tx: Tx, formId: string): Promise<FormRow> {
  const [row] = await tx.select().from(schema.form).where(eq(schema.form.id, formId));
  if (!row) throw new ServiceError("not_found", "양식을 찾을 수 없습니다");
  return row;
}

/** 양식과 첫 버전을 만든다 (APV-004). 같은 코드가 있으면 중복 오류 */
export async function createForm(ctx: ServiceContext, meta: FormMeta, version: FormVersionInput) {
  validateVersion(version);
  const [form] = await ctx.tx
    .insert(schema.form)
    .values({
      accountId: ctx.accountId,
      code: meta.code,
      name: meta.name,
      category: meta.category,
      scope: meta.scope ?? {},
      createdBy: ctx.userId,
    })
    .returning({ id: schema.form.id });
  if (!form) throw new Error("양식 생성 실패");
  const [v] = await ctx.tx
    .insert(schema.formVersion)
    .values(versionValues(ctx.accountId, form.id, 1, version, ctx.userId))
    .returning({ id: schema.formVersion.id });
  if (!v) throw new Error("양식 버전 생성 실패");
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "form.create",
    target: { type: "form", id: form.id, label: meta.name },
    result: "success",
    request: ctx.request,
  });
  return { formId: form.id, versionId: v.id, version: 1 };
}

/** 양식을 수정하면 새 버전이 된다. 이미 작성된 문서는 작성 당시 버전을 그대로 쓴다 (APV-005) */
export async function publishVersion(
  ctx: ServiceContext,
  formId: string,
  version: FormVersionInput,
  meta?: Partial<Omit<FormMeta, "code">>,
) {
  validateVersion(version);
  const form = await getForm(ctx.tx, formId);
  const current = await latestVersion(ctx.tx, formId);
  const next = current.version + 1;
  const [v] = await ctx.tx
    .insert(schema.formVersion)
    .values(versionValues(ctx.accountId, formId, next, version, ctx.userId))
    .returning({ id: schema.formVersion.id });
  if (!v) throw new Error("양식 버전 생성 실패");
  if (meta && Object.keys(meta).length > 0) {
    await ctx.tx.update(schema.form).set(meta).where(eq(schema.form.id, formId));
  } else {
    await ctx.tx.update(schema.form).set({ updatedAt: ctx.now }).where(eq(schema.form.id, formId));
  }
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "form.publish_version",
    target: { type: "form", id: formId, label: `${form.name} v${next}` },
    result: "success",
    request: ctx.request,
  });
  return { versionId: v.id, version: next };
}

export async function setFormActive(ctx: ServiceContext, formId: string, active: boolean) {
  const form = await getForm(ctx.tx, formId);
  await ctx.tx.update(schema.form).set({ active }).where(eq(schema.form.id, formId));
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: active ? "form.activate" : "form.deactivate",
    target: { type: "form", id: formId, label: form.name },
    result: "success",
    request: ctx.request,
  });
}

/** 양식을 새 코드·이름으로 복제한다. 최신 버전이 첫 버전이 된다 (APV-006) */
export async function duplicateForm(
  ctx: ServiceContext,
  formId: string,
  target: { code: string; name: string },
) {
  const form = await getForm(ctx.tx, formId);
  const v = await latestVersion(ctx.tx, formId);
  return createForm(
    ctx,
    { code: target.code, name: target.name, category: form.category, scope: form.scope },
    versionToInput(v),
  );
}

export function versionToInput(v: VersionRow): FormVersionInput {
  return {
    schema: v.schema as unknown as FormSchema,
    layout: v.layout,
    defaultLine: v.defaultLine as unknown as DraftLineItem[],
    numbering: v.numbering as unknown as FormNumbering | null,
    retentionYears: v.retentionYears as FormVersionInput["retentionYears"],
    securityDefault: v.securityDefault,
    recipients: v.recipients,
    allowLineEdit: v.allowLineEdit,
    policy: v.policy as unknown as ApprovalPolicy,
  };
}

export interface FormExport {
  format: "fmerp-form/1";
  code: string;
  name: string;
  category: string;
  version: FormVersionInput;
}

/** JSON 내보내기 (APV-006). 계정·사업자 id가 들어가는 사용 범위·수신자 기본값은 포함하지 않는다 */
export async function exportForm(tx: Tx, formId: string): Promise<FormExport> {
  const form = await getForm(tx, formId);
  const v = await latestVersion(tx, formId);
  const { recipients: _recipients, ...rest } = versionToInput(v);
  return {
    format: "fmerp-form/1",
    code: form.code,
    name: form.name,
    category: form.category,
    version: { ...rest, recipients: {} },
  };
}

export async function importForm(
  ctx: ServiceContext,
  data: FormExport,
  override?: { code?: string; name?: string },
) {
  if (data.format !== "fmerp-form/1")
    throw new ServiceError("form_invalid", "지원하지 않는 양식 파일입니다");
  return createForm(
    ctx,
    {
      code: override?.code ?? data.code,
      name: override?.name ?? data.name,
      category: data.category,
    },
    data.version,
  );
}

/** 양식 목록: 각 양식의 최신 버전 요약과 함께. 일반 사용자에게는 사용 중인 양식만 보여 준다 */
export async function listForms(tx: Tx, opts: { includeInactive: boolean }) {
  const forms = await tx
    .select()
    .from(schema.form)
    .where(opts.includeInactive ? undefined : eq(schema.form.active, true))
    .orderBy(schema.form.category, schema.form.name);
  if (forms.length === 0) return [];
  const versions = await tx
    .select()
    .from(schema.formVersion)
    .where(
      inArray(
        schema.formVersion.formId,
        forms.map((f) => f.id),
      ),
    )
    .orderBy(desc(schema.formVersion.version));
  const latest = new Map<string, VersionRow>();
  for (const v of versions) if (!latest.has(v.formId)) latest.set(v.formId, v);
  return forms.map((f) => ({ form: f, latest: latest.get(f.id) as VersionRow }));
}

/** 이 사용자가 쓸 수 있는 양식인지: 사용 중이고 사용 범위(사업자·부서)에 든다 */
export function formUsableBy(
  form: FormRow,
  who: { businessIds: string[]; departmentIds: string[] },
): boolean {
  if (!form.active) return false;
  const { businessIds, departmentIds } = form.scope;
  const bizOk = !businessIds?.length || businessIds.some((b) => who.businessIds.includes(b));
  const deptOk = !departmentIds?.length || departmentIds.some((d) => who.departmentIds.includes(d));
  return bizOk && deptOk;
}

/** 즐겨찾기·최근 사용 (APV-010) */
export async function touchFormPref(
  ctx: ServiceContext,
  membershipId: string,
  formId: string,
  patch: { favorite?: boolean; used?: boolean },
) {
  const values = {
    accountId: ctx.accountId,
    membershipId,
    formId,
    favorite: patch.favorite ?? false,
    lastUsedAt: patch.used ? ctx.now : null,
  };
  await ctx.tx
    .insert(schema.userFormPref)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.userFormPref.membershipId, schema.userFormPref.formId],
      set: {
        ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}),
        ...(patch.used ? { lastUsedAt: ctx.now } : {}),
      },
    });
}

export async function loadPrefs(tx: Tx, membershipId: string) {
  return tx
    .select()
    .from(schema.userFormPref)
    .where(and(eq(schema.userFormPref.membershipId, membershipId)));
}

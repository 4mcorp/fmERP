import { can } from "@fmerp/core";
import { schema, type Tx, withTenant } from "@fmerp/db";
import { createRoute, z } from "@hono/zod-openapi";
import { asc, eq } from "drizzle-orm";
import { createDelegation, listDelegations, revokeDelegation } from "../approval/delegation";
import { ApprovalError } from "../approval/errors";
import { touchFormPref } from "../approval/forms";
import { createApproval, submitDocument } from "../approval/service";
import { type AppRouter, type DepsProvider, requireSession, requireTenant } from "../http";
import { ACCOUNT_TARGET, loadActor } from "../org-access";
import { errorResponses, json, OkSchema } from "./common";
import { serviceContext } from "./service-context";

const LineTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), membershipId: z.uuid() }),
  z.object({
    kind: z.literal("department"),
    departmentId: z.uuid(),
    mode: z.enum(["head", "any"]),
  }),
  z.object({ kind: z.literal("drafter_head"), levels: z.number().int().min(1).max(5).optional() }),
  z.object({ kind: z.literal("duty"), dutyName: z.string().min(1).max(50) }),
  z.object({
    kind: z.literal("business_ceo"),
    businessId: z.uuid(),
    positionName: z.string().min(1).max(50).optional(),
  }),
]);

export const LineItem = z.object({
  type: z.enum(["approve", "agree", "cooperate", "audit", "post"]),
  seq: z.number().int().min(1).max(100),
  target: LineTarget,
  quorum: z.union([z.literal("all"), z.number().int().min(1).max(50)]).optional(),
});

// 전결 권한(canFinalize)·정책(policy)·문서번호 규칙(numbering)은 양식(M4)과 위임전결 규정(P1)이 정하므로
// 기안자가 API로 지정할 수 없다 (권한 상승·번호 시리즈 오염 방지)
const CreateInput = z.object({
  businessId: z.uuid(),
  drafterDepartmentId: z.uuid().optional(),
  title: z.string().trim().min(1).max(200),
  /** 기안은 양식으로 한다. 결재선 규칙·정책·문서번호·보안 등급 기본값은 양식(최신 버전)이 정한다 */
  formId: z.uuid(),
  body: z.record(z.string(), z.unknown()).optional(),
  securityLevel: z.enum(["normal", "confidential", "secret"]).optional(),
  urgent: z.boolean().optional(),
  desiredDueDate: z.iso.date().optional(),
  sourceType: z.string().trim().max(50).optional(),
  sourceId: z.string().trim().max(100).optional(),
  /** 양식이 결재선 수정을 허용할 때만 쓰인다. 생략하면 양식의 기본 결재선 */
  line: z.array(LineItem).min(1).max(30).optional(),
  relatedDocumentIds: z.array(z.uuid()).max(20).optional(),
  allowDuplicate: z.boolean().optional(),
  /** true이면 만든 뒤 바로 상신한다 */
  submit: z.boolean().optional(),
});

const DelegationInput = z.object({
  /** 비우면 본인. 다른 사람의 부재를 설정하려면 대행 권한이 필요하다 (APV-052) */
  membershipId: z.uuid().optional(),
  delegateMembershipId: z.uuid(),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("all") }),
    z.object({
      kind: z.literal("category"),
      categories: z.array(z.string().min(1).max(50)).min(1).max(20),
    }),
  ]),
  reason: z.string().trim().max(200).optional(),
});

/** 결재 요청 생성(ERP 모듈 연동 포함, APV-090)과 부재·대결 설정 (APV-050·052). 처리 API·화면은 M4 */
export function registerApprovalRoutes(app: AppRouter, deps: DepsProvider) {
  for (const prefix of ["/approvals", "/delegations"]) {
    app.use(prefix, requireSession(deps), requireTenant(deps));
    app.use(`${prefix}/*`, requireSession(deps), requireTenant(deps));
  }

  const serviceCtx = (c: Parameters<typeof serviceContext>[0], tx: Tx) =>
    serviceContext(c, deps(), tx);

  app.openapi(
    createRoute({
      method: "post",
      path: "/approvals",
      tags: ["approval"],
      summary:
        "결재 요청 생성 (결재선 해석·검증, submit=true면 상신까지). ERP 모듈은 sourceType·sourceId로 연동한다",
      request: { body: { content: { "application/json": { schema: CreateInput } } } },
      responses: {
        201: json(
          z.object({
            documentId: z.string(),
            status: z.string(),
            docNo: z.string().nullable(),
            warnings: z.array(z.string()),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { submit: submitNow, ...input } = c.req.valid("json");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        const ctx = serviceCtx(c, tx);
        const created = await createApproval(ctx, { ...input, drafterMembershipId: membershipId });
        await touchFormPref(ctx, membershipId, input.formId, { used: true });
        let status = "DRAFT";
        let docNo: string | null = null;
        if (submitNow) {
          const submitted = await submitDocument(ctx, created.documentId, membershipId);
          status = submitted.doc.status;
          docNo = submitted.docNo ?? null;
        }
        return { documentId: created.documentId, status, docNo, warnings: created.warnings };
      });
      return c.json(result, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/approvals/{id}",
      tags: ["approval"],
      summary: "결재 문서 진행 현황 (기안자 또는 결재선 참여자)",
      request: { params: z.object({ id: z.uuid() }) },
      responses: {
        200: json(
          z.object({
            id: z.string(),
            title: z.string(),
            status: z.string(),
            docNo: z.string().nullable(),
            businessId: z.string(),
            drafterMembershipId: z.string(),
            drafterSnapshot: z.record(z.string(), z.unknown()),
            formVersionId: z.string().nullable(),
            securityLevel: z.string(),
            urgent: z.boolean(),
            desiredDueDate: z.string().nullable(),
            latestRevision: z.number().int(),
            supersedes: z.string().nullable(),
            submittedAt: z.string().nullable(),
            completedAt: z.string().nullable(),
            steps: z.array(
              z.object({
                id: z.string(),
                seq: z.number().int(),
                type: z.string(),
                status: z.string(),
                version: z.number().int(),
                canFinalize: z.boolean(),
                assignees: z.array(z.record(z.string(), z.unknown())),
              }),
            ),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        const [doc] = await tx.select().from(schema.document).where(eq(schema.document.id, id));
        if (!doc) throw new ApprovalError("not_found", "문서를 찾을 수 없습니다");
        const steps = await tx
          .select()
          .from(schema.approvalStep)
          .where(eq(schema.approvalStep.documentId, id))
          .orderBy(asc(schema.approvalStep.seq), asc(schema.approvalStep.id));
        const participant =
          doc.drafterMembershipId === membershipId ||
          steps.some(
            (s) =>
              s.assigneeIds.includes(membershipId) ||
              Object.values(s.delegates).includes(membershipId),
          );
        // 관리자라고 문서를 볼 수 있는 것은 아니다 (PRD 3.3 각주 1). 감사인·공람 등은 M5(PERM-003)에서 추가한다
        if (!participant) throw new ApprovalError("not_found", "문서를 찾을 수 없습니다");
        return {
          id: doc.id,
          title: doc.title,
          status: doc.status,
          docNo: doc.docNo,
          businessId: doc.businessId,
          drafterMembershipId: doc.drafterMembershipId,
          drafterSnapshot: doc.drafterSnapshot,
          formVersionId: doc.formVersionId,
          securityLevel: doc.securityLevel,
          urgent: doc.urgent,
          desiredDueDate: doc.desiredDueDate,
          latestRevision: doc.latestRevision,
          supersedes: doc.supersedes,
          submittedAt: doc.submittedAt?.toISOString() ?? null,
          completedAt: doc.completedAt?.toISOString() ?? null,
          steps: steps.map((s) => ({
            id: s.id,
            seq: s.seq,
            type: s.type,
            status: s.status,
            version: s.version,
            canFinalize: s.canFinalize,
            assignees: s.assigneeSnapshot,
          })),
        };
      });
      return c.json(result, 200);
    },
  );

  // ===== 부재·대결 (APV-050·052) =====
  const DelegationSchema = z
    .object({
      id: z.string(),
      membershipId: z.string(),
      delegateMembershipId: z.string(),
      from: z.string(),
      to: z.string(),
      scope: z.record(z.string(), z.unknown()),
      reason: z.string().nullable(),
    })
    .openapi("Delegation");

  app.openapi(
    createRoute({
      method: "get",
      path: "/delegations",
      tags: ["approval"],
      summary: "부재 설정 목록 (본인 관련, 대행 권한자는 전체)",
      responses: { 200: json(z.array(DelegationSchema)), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const rows = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor, membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        const all = await listDelegations(serviceCtx(c, tx));
        return can(actor, "delegation.manage", ACCOUNT_TARGET)
          ? all
          : all.filter(
              (r) => r.membershipId === membershipId || r.delegateMembershipId === membershipId,
            );
      });
      return c.json(
        rows.map((r) => ({
          id: r.id,
          membershipId: r.membershipId,
          delegateMembershipId: r.delegateMembershipId,
          from: r.validFrom.toISOString(),
          to: r.validTo.toISOString(),
          scope: { ...r.scope },
          reason: r.reason,
        })),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/delegations",
      tags: ["approval"],
      summary: "부재·대결 설정 (연쇄 위임·기간 중복 금지). 다른 사람의 부재 설정은 관리자 대행",
      request: { body: { content: { "application/json": { schema: DelegationInput } } } },
      responses: { 201: json(z.object({ id: z.string() })), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const body = c.req.valid("json");
      const created = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor, membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        const target = body.membershipId ?? membershipId;
        if (target !== membershipId && !can(actor, "delegation.manage", ACCOUNT_TARGET)) {
          throw new ApprovalError("forbidden", "다른 사람의 부재를 설정할 권한이 없습니다");
        }
        return createDelegation(serviceCtx(c, tx), {
          membershipId: target,
          delegateMembershipId: body.delegateMembershipId,
          from: new Date(body.from),
          to: new Date(body.to),
          scope: body.scope,
          reason: body.reason,
        });
      });
      return c.json(created, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/delegations/{id}",
      tags: ["approval"],
      summary: "부재 설정 취소 (본인 또는 대행 권한자)",
      request: { params: z.object({ id: z.uuid() }) },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor, membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        const [row] = await tx.select().from(schema.delegation).where(eq(schema.delegation.id, id));
        if (!row) throw new ApprovalError("not_found", "부재 설정을 찾을 수 없습니다");
        if (row.membershipId !== membershipId && !can(actor, "delegation.manage", ACCOUNT_TARGET)) {
          throw new ApprovalError("forbidden", "부재 설정을 취소할 권한이 없습니다");
        }
        await revokeDelegation(serviceCtx(c, tx), id);
      });
      return c.json({ ok: true as const }, 200);
    },
  );
}

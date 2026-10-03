// 결재 서비스: core 엔진을 호출하고 결과를 한 트랜잭션에서 저장한다 (ADR 0007).
// 호출자는 withTenant 트랜잭션 안에서 부른다. 권한(누가 이 문서를 볼 수 있나)은 호출 쪽 라우트가 확인한다.
import { type AuditRequestContext, recordAudit } from "@fmerp/audit";
import {
  type ApprovalAction,
  type ApprovalActor,
  type ApprovalDoc,
  type ApprovalPolicy,
  act,
  DEFAULT_POLICY,
  type DelegationRule,
  type DocNumberContext,
  type DraftLineItem,
  decideDelegate,
  type EngineContext,
  type EngineResult,
  type ResetCycle,
  type ResolvedLineItem,
  redraftSeed,
  renderDocNumber,
  reopenDraft,
  resolveLine,
  seriesKey,
  submit,
  validateDocNumberRule,
  validateLine,
  withdraw,
} from "@fmerp/core";
import { schema, type Tx } from "@fmerp/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ApprovalError } from "./errors";
import { loadMemberCards, loadOrgSnapshot } from "./org-snapshot";
import { type LoadedDocument, lockAndLoad, persistResult } from "./store";

export interface ServiceContext {
  tx: Tx;
  accountId: string;
  now: Date;
  userId: string | null;
  request: AuditRequestContext;
}

type Numbering = NonNullable<(typeof schema.document.$inferSelect)["numbering"]>;

export interface CreateApprovalInput {
  businessId: string;
  drafterMembershipId: string;
  /** 겸직자가 기안 소속을 고를 때. 없으면 주소속 (ORG-033) */
  drafterDepartmentId?: string;
  title: string;
  body?: Record<string, unknown>;
  formCategory?: string;
  policy?: Partial<ApprovalPolicy>;
  numbering?: Numbering;
  sourceType?: string;
  sourceId?: string;
  line: DraftLineItem[];
  /** 같은 사람이 여러 단계에 있는 것을 허용할지 (APV-038) */
  allowDuplicate?: boolean;
}

/** 스냅샷 객체를 jsonb 열 타입으로 바꾼다 */
const asRecord = (value: object) => value as Record<string, unknown>;

function unwrap(result: EngineResult) {
  if (!result.ok) throw new ApprovalError(result.code, result.message);
  return result;
}

// ===== 부재·대결 규칙을 엔진 컨텍스트로 =====
export async function loadDelegationRules(tx: Tx): Promise<(DelegationRule & { id: string })[]> {
  const rows = await tx.select().from(schema.delegation).where(isNull(schema.delegation.revokedAt));
  return rows.map((r) => ({
    id: r.id,
    membershipId: r.membershipId,
    delegateId: r.delegateMembershipId,
    from: r.validFrom,
    to: r.validTo,
    scope:
      r.scope.kind === "category"
        ? { kind: "category" as const, categories: r.scope.categories ?? [] }
        : { kind: "all" as const },
  }));
}

export async function engineContext(
  ctx: ServiceContext,
  category: string | null,
): Promise<EngineContext> {
  const rules = await loadDelegationRules(ctx.tx);
  return {
    now: ctx.now,
    decideDelegate: (assigneeId) =>
      decideDelegate(assigneeId, rules, { now: ctx.now, category: category ?? undefined }),
  };
}

// ===== 문서번호 (APV-060·061) =====
/** 시리즈 행을 한 문장으로 올려 누락·중복 없이 채번한다. 같은 트랜잭션이 롤백되면 번호도 되돌아간다 */
export async function allocateDocNumber(
  ctx: ServiceContext,
  businessId: string,
  numbering: Numbering,
): Promise<string> {
  const check = validateDocNumberRule(numbering.rule);
  if (!check.ok) throw new ApprovalError("rule_invalid", check.reason);
  const [business] = await ctx.tx
    .select({ code: schema.business.code })
    .from(schema.business)
    .where(eq(schema.business.id, businessId));
  if (!business) throw new ApprovalError("not_found", "사업자를 찾을 수 없습니다");
  const numberCtx: DocNumberContext = {
    businessCode: business.code,
    departmentCode: numbering.departmentCode,
    formCode: numbering.formCode,
    date: ctx.now,
  };
  const key = seriesKey(numbering.rule, numberCtx, numbering.cycle as ResetCycle);
  const [series] = await ctx.tx
    .insert(schema.docNumberSeries)
    .values({ accountId: ctx.accountId, businessId, key, lastSeq: 1 })
    .onConflictDoUpdate({
      target: [schema.docNumberSeries.businessId, schema.docNumberSeries.key],
      set: { lastSeq: sql`${schema.docNumberSeries.lastSeq} + 1`, updatedAt: ctx.now },
    })
    .returning({ lastSeq: schema.docNumberSeries.lastSeq });
  if (!series) throw new Error("채번 실패");
  return renderDocNumber(numbering.rule, { ...numberCtx, seq: series.lastSeq });
}

// ===== 기안 =====
/** 결재선을 해석·검증해 초안 문서를 만든다 (APV-015·031·038·090) */
export async function createApproval(ctx: ServiceContext, input: CreateApprovalInput) {
  const { tx } = ctx;
  const org = await loadOrgSnapshot(tx);
  const departmentIds = org.assignments
    .filter(
      (a) => a.membershipId === input.drafterMembershipId && a.businessId === input.businessId,
    )
    .map((a) => a.departmentId);
  const drafterDepartmentId = input.drafterDepartmentId ?? departmentIds[0];
  if (!drafterDepartmentId || !departmentIds.includes(drafterDepartmentId)) {
    throw new ApprovalError("line_invalid", "기안자의 소속(부서)을 확인할 수 없습니다");
  }

  const resolved = resolveLine(input.line, org, {
    membershipId: input.drafterMembershipId,
    departmentId: drafterDepartmentId,
  });
  if (!resolved.ok) {
    throw new ApprovalError("line_invalid", "결재선을 해석할 수 없습니다", {
      errors: resolved.errors,
    });
  }
  const ranks = new Map<string, number>();
  for (const a of org.assignments) {
    if (a.positionRank !== null)
      ranks.set(a.membershipId, Math.max(ranks.get(a.membershipId) ?? 0, a.positionRank));
  }
  const inactive = new Set(
    org.members.filter((m) => m.status !== "active").map((m) => m.membershipId),
  );
  const validation = validateLine(resolved.steps, {
    drafterId: input.drafterMembershipId,
    allowDuplicate: input.allowDuplicate ?? false,
    ranks,
    inactive,
  });
  if (validation.errors.length > 0) {
    throw new ApprovalError("line_invalid", validation.errors.join("; "), {
      errors: validation.errors,
    });
  }
  if (input.numbering) {
    const check = validateDocNumberRule(input.numbering.rule);
    if (!check.ok) throw new ApprovalError("rule_invalid", check.reason);
  }

  const cards = await loadMemberCards(tx, [
    input.drafterMembershipId,
    ...resolved.steps.flatMap((s) => s.assigneeIds),
  ]);
  const [doc] = await tx
    .insert(schema.document)
    .values({
      accountId: ctx.accountId,
      businessId: input.businessId,
      drafterMembershipId: input.drafterMembershipId,
      drafterSnapshot: asRecord(cards.get(input.drafterMembershipId) ?? {}),
      title: input.title,
      body: input.body ?? {},
      policy: { ...DEFAULT_POLICY, ...input.policy },
      numbering: input.numbering,
      formCategory: input.formCategory,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    })
    .returning({ id: schema.document.id });
  if (!doc) throw new Error("문서 생성 실패");
  await insertSteps(ctx, doc.id, resolved.steps, cards);

  await recordAudit(tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "approval.create",
    target: { type: "document", id: doc.id, label: input.title },
    result: "success",
    request: ctx.request,
  });
  return { documentId: doc.id, warnings: validation.warnings };
}

async function insertSteps(
  ctx: ServiceContext,
  documentId: string,
  steps: ResolvedLineItem[],
  cards: Awaited<ReturnType<typeof loadMemberCards>>,
) {
  // 같은 seq 안의 순서를 유지하려고 하나씩 넣는다 (uuidv7이 시간순이다)
  for (const s of steps) {
    await ctx.tx.insert(schema.approvalStep).values({
      accountId: ctx.accountId,
      documentId,
      seq: s.seq,
      type: s.type,
      assigneeIds: s.assigneeIds,
      assigneeSnapshot: s.assigneeIds.map((id) => asRecord(cards.get(id) ?? { membershipId: id })),
      canFinalize: s.canFinalize,
      quorum: s.quorum === "all" ? null : s.quorum,
    });
  }
}

// ===== 상신·처리·회수 =====
async function finish(
  ctx: ServiceContext,
  loaded: LoadedDocument,
  result: Extract<EngineResult, { ok: true }>,
  opts: {
    idempotencyKey: string | null;
    patch?: Partial<typeof schema.document.$inferInsert>;
    auditAction: string;
    comment?: string | null;
  },
) {
  const patch: Partial<typeof schema.document.$inferInsert> = { ...opts.patch };
  const { row } = loaded;
  if (result.doc.status === "COMPLETED" && loaded.doc.status !== "COMPLETED") {
    patch.completedAt = ctx.now;
    if (row.numbering?.at === "complete" && !row.docNo) {
      patch.docNo = await allocateDocNumber(ctx, row.businessId, row.numbering);
    }
  }
  await persistResult(ctx.tx, loaded, result, patch, opts.idempotencyKey, ctx.request);
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: opts.auditAction,
    target: { type: "document", id: row.id, label: row.title },
    result: "success",
    reason: opts.comment ?? undefined,
    request: ctx.request,
  });
  return { doc: result.doc, events: result.events, docNo: patch.docNo ?? row.docNo };
}

export async function submitDocument(
  ctx: ServiceContext,
  documentId: string,
  actorMembershipId: string,
) {
  const loaded = await lockAndLoad(ctx.tx, documentId);
  if (loaded.row.drafterMembershipId !== actorMembershipId) {
    throw new ApprovalError("forbidden", "기안자만 상신할 수 있습니다");
  }
  const result = unwrap(submit(loaded.doc, await engineContext(ctx, loaded.row.formCategory)));
  const patch: Partial<typeof schema.document.$inferInsert> = { submittedAt: ctx.now };
  if (loaded.row.numbering?.at === "submit" && !loaded.row.docNo) {
    patch.docNo = await allocateDocNumber(ctx, loaded.row.businessId, loaded.row.numbering);
  }
  return finish(ctx, loaded, result, {
    idempotencyKey: null,
    patch,
    auditAction: "approval.submit",
  });
}

export interface ActOptions {
  /** 같은 키로 다시 요청하면 같은 결과를 돌려준다 (APV-045) */
  idempotencyKey: string;
  expectedVersion?: number;
}

export async function actOnStep(
  ctx: ServiceContext,
  documentId: string,
  stepId: string,
  action: ApprovalAction,
  actor: ApprovalActor,
  opts: ActOptions,
) {
  const loaded = await lockAndLoad(ctx.tx, documentId);
  const [existing] = await ctx.tx
    .select({ id: schema.approvalAction.id })
    .from(schema.approvalAction)
    .where(
      and(
        eq(schema.approvalAction.stepId, stepId),
        eq(schema.approvalAction.idempotencyKey, opts.idempotencyKey),
      ),
    );
  if (existing) {
    // 이미 처리된 요청의 재시도: 현재 상태를 그대로 돌려준다
    return { doc: loaded.doc, events: [], docNo: loaded.row.docNo, replayed: true as const };
  }
  const result = unwrap(
    act(
      loaded.doc,
      stepId,
      action,
      actor,
      await engineContext(ctx, loaded.row.formCategory),
      opts.expectedVersion,
    ),
  );
  const saved = await finish(ctx, loaded, result, {
    idempotencyKey: opts.idempotencyKey,
    auditAction: `approval.${action.kind}`,
    comment: result.record?.comment,
  });
  return { ...saved, replayed: false as const };
}

export async function withdrawDocument(
  ctx: ServiceContext,
  documentId: string,
  actorMembershipId: string,
) {
  const loaded = await lockAndLoad(ctx.tx, documentId);
  const result = unwrap(
    withdraw(loaded.doc, actorMembershipId, await engineContext(ctx, loaded.row.formCategory)),
  );
  // 회수 기록은 첫 단계에 남긴다 (처리 기록은 단계에 매달린다)
  return finish(ctx, loaded, result, {
    idempotencyKey: `withdraw:${ctx.now.getTime()}`,
    auditAction: "approval.withdraw",
  });
}

/** 회수한 문서를 초안으로 되돌려 수정할 수 있게 한다 */
export async function reopenDocument(
  ctx: ServiceContext,
  documentId: string,
  actorMembershipId: string,
) {
  const loaded = await lockAndLoad(ctx.tx, documentId);
  if (loaded.row.drafterMembershipId !== actorMembershipId) {
    throw new ApprovalError("forbidden", "기안자만 수정할 수 있습니다");
  }
  const result = unwrap(reopenDraft(loaded.doc));
  return finish(ctx, loaded, result, { idempotencyKey: null, auditAction: "approval.reopen" });
}

/** 반려된 문서를 복사해 새 초안을 만들고 원문과 연결한다 (APV-019) */
export async function redraftDocument(
  ctx: ServiceContext,
  documentId: string,
  actorMembershipId: string,
) {
  const loaded = await lockAndLoad(ctx.tx, documentId);
  if (loaded.row.drafterMembershipId !== actorMembershipId) {
    throw new ApprovalError("forbidden", "기안자만 재기안할 수 있습니다");
  }
  const seed = redraftSeed(loaded.doc, (old) => old);
  if (!seed.ok) throw new ApprovalError(seed.code, seed.message);
  const { row } = loaded;
  const [copy] = await ctx.tx
    .insert(schema.document)
    .values({
      accountId: ctx.accountId,
      businessId: row.businessId,
      drafterMembershipId: row.drafterMembershipId,
      drafterSnapshot: row.drafterSnapshot,
      title: row.title,
      body: row.body,
      policy: row.policy,
      numbering: row.numbering,
      formCategory: row.formCategory,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      supersedes: row.id,
    })
    .returning({ id: schema.document.id });
  if (!copy) throw new Error("재기안 생성 실패");
  for (const s of loaded.stepRows) {
    await ctx.tx.insert(schema.approvalStep).values({
      accountId: ctx.accountId,
      documentId: copy.id,
      seq: s.seq,
      type: s.type,
      assigneeIds: s.assigneeIds,
      assigneeSnapshot: s.assigneeSnapshot,
      canFinalize: s.canFinalize,
      quorum: s.quorum,
    });
  }
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "approval.redraft",
    target: { type: "document", id: copy.id, label: row.title },
    reason: `원문 ${row.id}`,
    result: "success",
    request: ctx.request,
  });
  return { documentId: copy.id, supersedes: row.id };
}

export type { ApprovalDoc };

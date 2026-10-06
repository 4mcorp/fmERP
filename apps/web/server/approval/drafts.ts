// 기안 본문(S3 리비전)·내용 해시·무결성 확인 (PRD BAK-002, APV-011·016, ADR 0008)
import { createHash } from "node:crypto";
import { recordAudit } from "@fmerp/audit";
import { type FormSchema, validateFormValues } from "@fmerp/core";
import { schema } from "@fmerp/db";
import type { ServiceContext } from "@fmerp/shared/server/context";
import { ApprovalError } from "@fmerp/shared/server/errors";
import { asc, desc, eq } from "drizzle-orm";
import { docPrefix, revisionKey } from "./document-storage";
import { getFormVersion } from "./forms";
import { lockAndLoad } from "./store";

type DocRow = typeof schema.document.$inferSelect;

const MAX_BODY_BYTES = 1_000_000;

export const sha256Hex = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

async function businessCodeOf(ctx: ServiceContext, businessId: string): Promise<string> {
  const [b] = await ctx.tx
    .select({ code: schema.business.code })
    .from(schema.business)
    .where(eq(schema.business.id, businessId));
  if (!b) throw new ApprovalError("not_found", "사업자를 찾을 수 없습니다");
  return b.code;
}

export async function documentPrefix(ctx: ServiceContext, doc: DocRow): Promise<string> {
  return docPrefix(doc.accountId, await businessCodeOf(ctx, doc.businessId), doc.createdAt, doc.id);
}

async function attachmentCount(ctx: ServiceContext, documentId: string): Promise<number> {
  const rows = await ctx.tx
    .select({ id: schema.attachment.id })
    .from(schema.attachment)
    .where(eq(schema.attachment.documentId, documentId));
  return rows.length;
}

/**
 * 양식 입력값을 검증·정규화한다. 양식이 있으면 작성 당시 버전의 스키마로, 없으면 크기만 본다.
 * 초안 저장은 필수 검사를 건너뛰고(`draft`), 상신은 전체를 검사한다.
 */
export async function validateBody(
  ctx: ServiceContext,
  doc: DocRow,
  body: Record<string, unknown>,
  mode: "draft" | "submit",
): Promise<Record<string, unknown>> {
  if (JSON.stringify(body).length > MAX_BODY_BYTES) {
    throw new ApprovalError("validation_failed", "본문이 너무 큽니다");
  }
  if (!doc.formVersionId) return body;
  const version = await getFormVersion(ctx.tx, doc.formVersionId);
  const result = validateFormValues(version.schema as unknown as FormSchema, body, {
    draft: mode === "draft",
    attachmentCount: await attachmentCount(ctx, doc.id),
  });
  if (!result.ok) {
    throw new ApprovalError("validation_failed", "입력값을 확인하세요", { errors: result.errors });
  }
  return result.values;
}

/** 본문을 새 리비전으로 저장한다: S3에 새 키로 쓰고(덮어쓰기 없음) 색인과 최신 번호를 같은 트랜잭션에 기록 */
export async function writeRevision(
  ctx: ServiceContext,
  doc: DocRow,
  body: Record<string, unknown>,
  savedByMembershipId: string,
): Promise<number> {
  const n = doc.latestRevision + 1;
  const json = JSON.stringify(body);
  const key = revisionKey(await documentPrefix(ctx, doc), n);
  try {
    await ctx.storage.putIfAbsent(key, json, "application/json");
  } catch {
    throw new ApprovalError(
      "revision_conflict",
      "다른 저장과 겹쳤습니다. 새로고침 후 다시 저장하세요",
    );
  }
  await ctx.tx.insert(schema.documentRevision).values({
    accountId: ctx.accountId,
    documentId: doc.id,
    n,
    storageKey: key,
    sha256: sha256Hex(json),
    size: Buffer.byteLength(json),
    savedByMembershipId,
  });
  await ctx.tx
    .update(schema.document)
    .set({ latestRevision: n })
    .where(eq(schema.document.id, doc.id));
  return n;
}

export interface SaveDraftInput {
  documentId: string;
  actorMembershipId: string;
  body?: Record<string, unknown>;
  title?: string;
  securityLevel?: "normal" | "confidential" | "secret";
  urgent?: boolean;
  desiredDueDate?: string | null;
  /** 클라이언트가 마지막으로 본 리비전 번호. 다르면 다른 저장과 겹친 것이다 */
  expectedRevision?: number;
}

/** 임시저장(수동·30초 자동). 초안 상태의 기안자만 할 수 있다 (APV-011) */
export async function saveDraft(ctx: ServiceContext, input: SaveDraftInput) {
  const loaded = await lockAndLoad(ctx.tx, input.documentId);
  const doc = loaded.row;
  if (doc.drafterMembershipId !== input.actorMembershipId) {
    throw new ApprovalError("forbidden", "기안자만 저장할 수 있습니다");
  }
  if (doc.status !== "DRAFT") {
    throw new ApprovalError("invalid_state", "상신된 문서는 수정할 수 없습니다 (회수 후 수정)");
  }
  if (input.expectedRevision !== undefined && input.expectedRevision !== doc.latestRevision) {
    throw new ApprovalError(
      "revision_conflict",
      "다른 곳에서 먼저 저장되었습니다. 새로고침 후 다시 저장하세요",
    );
  }

  let revision = doc.latestRevision;
  if (input.body) {
    const normalized = await validateBody(ctx, doc, input.body, "draft");
    revision = await writeRevision(ctx, doc, normalized, input.actorMembershipId);
  }
  const meta: Partial<typeof schema.document.$inferInsert> = {};
  if (input.title !== undefined) meta.title = input.title;
  if (input.securityLevel !== undefined) meta.securityLevel = input.securityLevel;
  if (input.urgent !== undefined) meta.urgent = input.urgent;
  if (input.desiredDueDate !== undefined) meta.desiredDueDate = input.desiredDueDate;
  if (Object.keys(meta).length > 0) {
    await ctx.tx.update(schema.document).set(meta).where(eq(schema.document.id, doc.id));
  }
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "approval.save_draft",
    target: { type: "document", id: doc.id, label: input.title ?? doc.title },
    result: "success",
    request: ctx.request,
  });
  return { revision };
}

/** 저장된 본문을 읽는다. 색인의 SHA-256과 다르면 변조로 보고 거부한다 */
export async function loadBody(
  ctx: ServiceContext,
  documentId: string,
  n?: number,
): Promise<{ revision: number; body: Record<string, unknown> } | null> {
  const [doc] = await ctx.tx
    .select()
    .from(schema.document)
    .where(eq(schema.document.id, documentId));
  if (!doc) throw new ApprovalError("not_found", "문서를 찾을 수 없습니다");
  const target = n ?? doc.latestRevision;
  if (target < 1) return null;
  const [rev] = await ctx.tx
    .select()
    .from(schema.documentRevision)
    .where(eq(schema.documentRevision.documentId, documentId))
    .orderBy(desc(schema.documentRevision.n));
  const row = n ? ((await revisionRow(ctx, documentId, n)) ?? undefined) : rev;
  if (!row) return null;
  const bytes = await ctx.storage.getBytes(row.storageKey);
  if (sha256Hex(bytes) !== row.sha256) {
    throw new ApprovalError("content_changed", "저장된 본문이 변경되었습니다 (무결성 오류)");
  }
  return {
    revision: row.n,
    body: JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>,
  };
}

async function revisionRow(ctx: ServiceContext, documentId: string, n: number) {
  const rows = await ctx.tx
    .select()
    .from(schema.documentRevision)
    .where(eq(schema.documentRevision.documentId, documentId))
    .orderBy(asc(schema.documentRevision.n));
  return rows.find((r) => r.n === n) ?? null;
}

/**
 * 상신 시점의 내용 해시 (APV-016): 제목 + 최신 본문 리비전 SHA-256 + 첨부 SHA-256 목록.
 * 결재자가 보는 내용이 상신 원본과 같은지 확인하는 기준이다.
 */
export async function computeContentHash(ctx: ServiceContext, doc: DocRow): Promise<string> {
  let revisionSha: string | null = null;
  if (doc.latestRevision > 0) {
    const row = await revisionRow(ctx, doc.id, doc.latestRevision);
    revisionSha = row?.sha256 ?? null;
  }
  const attachments = await ctx.tx
    .select({ sha256: schema.attachment.sha256 })
    .from(schema.attachment)
    .where(eq(schema.attachment.documentId, doc.id));
  return sha256Hex(
    JSON.stringify({
      title: doc.title,
      revision: revisionSha,
      attachments: attachments.map((a) => a.sha256).sort(),
    }),
  );
}

/** 처리 때 확인: DB 색인 기준 해시가 상신 해시와 같고, S3 본문도 색인의 해시와 같아야 한다 */
export async function verifyIntegrity(ctx: ServiceContext, doc: DocRow): Promise<void> {
  if (!doc.contentHash) return;
  if ((await computeContentHash(ctx, doc)) !== doc.contentHash) {
    throw new ApprovalError("content_changed", "상신 이후 문서 내용이 바뀌어 처리할 수 없습니다");
  }
  if (doc.latestRevision > 0) await loadBody(ctx, doc.id);
}

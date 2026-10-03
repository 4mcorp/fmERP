// 첨부 (PRD APV-013, FILE-002·004·005, ADR 0008): 크기 고정 서명 업로드 → staging → 서버 검증 → 최종 키로 복사
import { randomUUID } from "node:crypto";
import { recordAudit } from "@fmerp/audit";
import {
  checkAttachment,
  DEFAULT_ALLOWED_EXTENSIONS,
  extensionOf,
  safeFileName,
} from "@fmerp/core";
import { schema } from "@fmerp/db";
import { eq } from "drizzle-orm";
import type { ServiceContext } from "./context";
import { attachmentKey, stagingKey, stagingPrefix } from "./document-storage";
import { documentPrefix } from "./drafts";
import { ApprovalError } from "./errors";
import { isParticipant } from "./service";

const MB = 1024 * 1024;
const DEFAULT_FILE_MB = 50;
const DEFAULT_DOCUMENT_MB = 300;
const SNIFF_BYTES = 4096;
const UPLOAD_URL_SECONDS = 600;

interface Limits {
  fileBytes: number;
  documentBytes: number;
  allowedExtensions: readonly string[];
}

async function loadLimits(ctx: ServiceContext): Promise<Limits> {
  const [account] = await ctx.tx
    .select({ policy: schema.account.securityPolicy })
    .from(schema.account)
    .where(eq(schema.account.id, ctx.accountId));
  const policy = account?.policy ?? {};
  return {
    fileBytes: (policy.attachmentMaxMb ?? DEFAULT_FILE_MB) * MB,
    documentBytes: DEFAULT_DOCUMENT_MB * MB,
    allowedExtensions: policy.attachmentExtensions?.length
      ? policy.attachmentExtensions
      : DEFAULT_ALLOWED_EXTENSIONS,
  };
}

async function draftOf(ctx: ServiceContext, documentId: string, membershipId: string) {
  const [doc] = await ctx.tx
    .select()
    .from(schema.document)
    .where(eq(schema.document.id, documentId));
  if (!doc) throw new ApprovalError("not_found", "문서를 찾을 수 없습니다");
  if (doc.drafterMembershipId !== membershipId) {
    throw new ApprovalError("forbidden", "기안자만 첨부를 바꿀 수 있습니다");
  }
  if (doc.status !== "DRAFT") {
    throw new ApprovalError(
      "invalid_state",
      "상신된 문서의 첨부는 바꿀 수 없습니다 (회수 후 수정)",
    );
  }
  return doc;
}

async function usedBytes(ctx: ServiceContext, documentId: string): Promise<number> {
  const rows = await ctx.tx
    .select({ size: schema.attachment.size })
    .from(schema.attachment)
    .where(eq(schema.attachment.documentId, documentId));
  return rows.reduce((sum, r) => sum + r.size, 0);
}

/** 업로드용 서명 URL 발급: 선언한 크기·확장자·문서 총량을 먼저 확인한다 */
export async function requestUpload(
  ctx: ServiceContext,
  input: { documentId: string; actorMembershipId: string; filename: string; size: number },
) {
  await draftOf(ctx, input.documentId, input.actorMembershipId);
  const limits = await loadLimits(ctx);
  if (!Number.isInteger(input.size) || input.size < 1) {
    throw new ApprovalError("attachment_invalid", "파일 크기가 올바르지 않습니다");
  }
  if (input.size > limits.fileBytes) {
    throw new ApprovalError(
      "attachment_invalid",
      `파일은 ${limits.fileBytes / MB}MB 이하여야 합니다`,
    );
  }
  const ext = extensionOf(input.filename);
  if (!limits.allowedExtensions.map((e) => e.toLowerCase()).includes(ext)) {
    throw new ApprovalError(
      "attachment_invalid",
      `허용되지 않는 파일 형식입니다${ext ? ` (.${ext})` : ""}`,
    );
  }
  if ((await usedBytes(ctx, input.documentId)) + input.size > limits.documentBytes) {
    throw new ApprovalError(
      "attachment_invalid",
      `문서당 첨부는 ${limits.documentBytes / MB}MB까지입니다`,
    );
  }
  const key = stagingKey(ctx.accountId, randomUUID());
  const uploadUrl = await ctx.storage.presignPutFixedSize(
    key,
    "application/octet-stream",
    input.size,
    UPLOAD_URL_SECONDS,
  );
  return { uploadUrl, stagingKey: key, contentType: "application/octet-stream" };
}

/**
 * 업로드가 끝난 객체를 검증해 첨부로 등록한다: 크기 일치, 형식(매직 바이트), SHA-256 계산, 최종 키로 복사.
 * 검증을 통과하지 못하면 등록하지 않으며, staging 객체는 버킷 수명 주기 규칙이 지운다.
 */
export async function registerAttachment(
  ctx: ServiceContext,
  input: {
    documentId: string;
    actorMembershipId: string;
    stagingKey: string;
    filename: string;
    declaredSize: number;
  },
) {
  const doc = await draftOf(ctx, input.documentId, input.actorMembershipId);
  if (!input.stagingKey.startsWith(stagingPrefix(ctx.accountId))) {
    throw new ApprovalError("forbidden", "이 회사의 업로드만 등록할 수 있습니다");
  }
  const limits = await loadLimits(ctx);
  const info = await ctx.storage.head(input.stagingKey);
  if (!info) throw new ApprovalError("attachment_invalid", "업로드된 파일이 없습니다");
  if (info.size !== input.declaredSize || info.size > limits.fileBytes) {
    throw new ApprovalError(
      "attachment_invalid",
      "업로드한 파일의 크기가 선언한 크기와 다르거나 한도를 넘습니다",
    );
  }
  if ((await usedBytes(ctx, doc.id)) + info.size > limits.documentBytes) {
    throw new ApprovalError(
      "attachment_invalid",
      `문서당 첨부는 ${limits.documentBytes / MB}MB까지입니다`,
    );
  }
  const filename = safeFileName(input.filename);
  const head = await ctx.storage.getRange(
    input.stagingKey,
    0,
    Math.min(info.size, SNIFF_BYTES) - 1,
  );
  const checked = checkAttachment({ filename, head, allowedExtensions: limits.allowedExtensions });
  if (!checked.ok) throw new ApprovalError("attachment_invalid", checked.reason);
  const { sha256, size } = await ctx.storage.hashObject(input.stagingKey);
  if (size !== info.size)
    throw new ApprovalError("attachment_invalid", "업로드한 파일의 크기를 확인할 수 없습니다");

  const id = randomUUID();
  const finalKey = attachmentKey(await documentPrefix(ctx, doc), id, filename);
  await ctx.storage.copyIfAbsent(input.stagingKey, finalKey);
  await ctx.tx.insert(schema.attachment).values({
    id,
    accountId: ctx.accountId,
    documentId: doc.id,
    storageKey: finalKey,
    filename,
    size,
    mime: checked.mime,
    sha256,
    uploadedByMembershipId: input.actorMembershipId,
  });
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "attachment.add",
    target: { type: "attachment", id, label: filename },
    result: "success",
    request: ctx.request,
  });
  return { id, filename, size, mime: checked.mime, sha256 };
}

export async function removeAttachment(
  ctx: ServiceContext,
  input: { documentId: string; attachmentId: string; actorMembershipId: string },
) {
  await draftOf(ctx, input.documentId, input.actorMembershipId);
  const rows = await ctx.tx
    .delete(schema.attachment)
    .where(eq(schema.attachment.id, input.attachmentId))
    .returning({
      id: schema.attachment.id,
      filename: schema.attachment.filename,
      documentId: schema.attachment.documentId,
    });
  const row = rows[0];
  if (!row || row.documentId !== input.documentId) {
    throw new ApprovalError("not_found", "첨부를 찾을 수 없습니다");
  }
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "attachment.remove",
    target: { type: "attachment", id: row.id, label: row.filename },
    result: "success",
    request: ctx.request,
  });
}

export function listAttachments(ctx: ServiceContext, documentId: string) {
  return ctx.tx
    .select({
      id: schema.attachment.id,
      filename: schema.attachment.filename,
      size: schema.attachment.size,
      mime: schema.attachment.mime,
      sha256: schema.attachment.sha256,
    })
    .from(schema.attachment)
    .where(eq(schema.attachment.documentId, documentId));
}

const PREVIEWABLE = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/;

/**
 * 다운로드·미리보기용 짧은 수명의 서명 URL (FILE-004·005). 문서 참여자만 받을 수 있고, 발급은 감사 로그에 남긴다.
 * 미리보기는 이미지·PDF만 (오피스 문서는 P1).
 */
export async function attachmentUrl(
  ctx: ServiceContext,
  input: { documentId: string; attachmentId: string; membershipId: string; preview: boolean },
) {
  if (!(await isParticipant(ctx, input.documentId, input.membershipId))) {
    throw new ApprovalError("not_found", "문서를 찾을 수 없습니다");
  }
  const [row] = await ctx.tx
    .select()
    .from(schema.attachment)
    .where(eq(schema.attachment.id, input.attachmentId));
  if (!row || row.documentId !== input.documentId) {
    throw new ApprovalError("not_found", "첨부를 찾을 수 없습니다");
  }
  if (input.preview && !PREVIEWABLE.test(row.mime)) {
    throw new ApprovalError("attachment_invalid", "미리보기를 지원하지 않는 형식입니다");
  }
  const url = await ctx.storage.presignGet(
    row.storageKey,
    300,
    input.preview
      ? { contentType: row.mime }
      : { downloadName: row.filename, contentType: row.mime },
  );
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: input.preview ? "attachment.preview" : "attachment.download",
    target: { type: "attachment", id: row.id, label: row.filename },
    result: "success",
    request: ctx.request,
  });
  return { url, filename: row.filename, mime: row.mime };
}

// 완료 문서 다운로드 (PRD BAK-008): PDF는 서명 URL, 패키지 ZIP은 스트리밍. 열람 권한자만, 모두 감사 로그에 남긴다.
import { PassThrough, type Readable } from "node:stream";
import { recordAudit } from "@fmerp/audit";
import { schema } from "@fmerp/db";
import type { DocumentAccess, Viewer } from "@fmerp/shared/contracts/document-access";
import type { ServiceContext } from "@fmerp/shared/server/context";
import { documentPrefix } from "@fmerp/shared/server/document-prefix";
import { ServiceError } from "@fmerp/shared/server/errors";
import { FINAL_FILES, finalKey } from "@fmerp/storage";
import { ZipArchive } from "archiver";
import { eq } from "drizzle-orm";

type PackageState = "NONE" | "PENDING" | "READY" | "FAILED";

async function loadDoc(ctx: ServiceContext, documentId: string) {
  const [doc] = await ctx.tx
    .select()
    .from(schema.document)
    .where(eq(schema.document.id, documentId));
  if (!doc) throw new ServiceError("not_found", "문서를 찾을 수 없습니다");
  return doc;
}

/** 완료 패키지 상태. 완료되지 않은 문서는 NONE이다 */
export async function packageStatus(
  ctx: ServiceContext,
  documentId: string,
  viewer: Viewer,
  access: DocumentAccess,
) {
  await access.requireView(ctx, documentId, viewer);
  const doc = await loadDoc(ctx, documentId);
  const [pkg] = await ctx.tx
    .select()
    .from(schema.documentPackage)
    .where(eq(schema.documentPackage.documentId, documentId));
  const state: PackageState =
    doc.status !== "COMPLETED" ? "NONE" : ((pkg?.status as PackageState | undefined) ?? "PENDING");
  return { status: state, readyAt: pkg?.readyAt ?? null };
}

async function requireReady(
  ctx: ServiceContext,
  documentId: string,
  viewer: Viewer,
  access: DocumentAccess,
) {
  await access.requireView(ctx, documentId, viewer);
  const doc = await loadDoc(ctx, documentId);
  const [pkg] = await ctx.tx
    .select()
    .from(schema.documentPackage)
    .where(eq(schema.documentPackage.documentId, documentId));
  if (doc.status !== "COMPLETED") {
    throw new ServiceError("invalid_state", "완료된 문서만 내려받을 수 있습니다");
  }
  if (pkg?.status !== "READY") {
    throw new ServiceError("invalid_state", "PDF를 만드는 중입니다. 잠시 뒤에 다시 시도하세요");
  }
  return doc;
}

/** ZIP을 열기 전 확인: 열람 권한과 패키지 준비 상태만 본다. 파일을 열지 않고 감사 로그도 남기지 않는다 */
export async function checkPackageDownload(
  ctx: ServiceContext,
  documentId: string,
  viewer: Viewer,
  access: DocumentAccess,
) {
  await requireReady(ctx, documentId, viewer, access);
}

const safeName = (doc: { docNo: string | null; title: string }, ext: string) =>
  `${(doc.docNo ?? doc.title).replace(/[\\/:*?"<>|\r\n]/g, "_").slice(0, 80)}.${ext}`;

/** 결재란이 찍힌 PDF의 짧은 수명 서명 URL (BAK-008) */
export async function packagePdfUrl(
  ctx: ServiceContext,
  documentId: string,
  viewer: Viewer,
  access: DocumentAccess,
) {
  const doc = await requireReady(ctx, documentId, viewer, access);
  const prefix = await documentPrefix(ctx, doc);
  const url = await ctx.storage.presignGet(finalKey(prefix, "document.pdf"), 300, {
    downloadName: safeName(doc, "pdf"),
    contentType: "application/pdf",
  });
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "document.download_pdf",
    target: { type: "document", id: doc.id, label: doc.title },
    result: "success",
    request: ctx.request,
  });
  return { url, filename: safeName(doc, "pdf") };
}

/**
 * 패키지 ZIP: `final/`의 4개 파일과 첨부(`attachments/`)를 흘려보낸다. 메모리에 쌓지 않고 객체를 스트림으로 이어 붙인다.
 * 감사 로그는 스트림을 열기 전에 남긴다.
 */
export async function openPackageZip(
  ctx: ServiceContext,
  documentId: string,
  viewer: Viewer,
  access: DocumentAccess,
): Promise<{ filename: string; stream: Readable }> {
  const doc = await requireReady(ctx, documentId, viewer, access);
  const prefix = await documentPrefix(ctx, doc);
  const attachments = await ctx.tx
    .select()
    .from(schema.attachment)
    .where(eq(schema.attachment.documentId, documentId));
  await recordAudit(ctx.tx, {
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: "document.download_package",
    target: { type: "document", id: doc.id, label: doc.title },
    result: "success",
    request: ctx.request,
  });

  const out = new PassThrough();
  const zip = new ZipArchive({ zlib: { level: 6 } });
  zip.on("error", (error) => out.destroy(error));
  zip.pipe(out);
  const storage = ctx.storage;
  // 파일을 하나씩 순서대로 이어 붙인다 (동시에 많은 객체 연결을 열지 않는다)
  void (async () => {
    try {
      for (const file of FINAL_FILES) {
        zip.append(await storage.getStream(finalKey(prefix, file)), { name: `final/${file}` });
        await new Promise<void>((resolve) => zip.once("entry", () => resolve()));
      }
      for (const a of attachments) {
        zip.append(await storage.getStream(a.storageKey), {
          name: `attachments/${a.id}_${a.filename.replace(/[\\/]/g, "_")}`,
        });
        await new Promise<void>((resolve) => zip.once("entry", () => resolve()));
      }
      await zip.finalize();
    } catch (error) {
      out.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  })();
  return { filename: safeName(doc, "zip"), stream: out };
}

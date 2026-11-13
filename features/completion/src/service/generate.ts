// 완료 패키지 생성 (PRD BAK-003·APV-063, ADR 0009). worker가 호출하고, PDF 변환은 renderPdf로 주입받는다.
import { recordAudit } from "@fmerp/audit";
import { type Db, schema, withTenant } from "@fmerp/db";
import {
  buildApprovalJson,
  buildDocumentJson,
  buildManifest,
  canonicalJson,
} from "@fmerp/shared/domain/completion-package";
import type { FormSchema } from "@fmerp/shared/domain/form-schema";
import { sha256Hex } from "@fmerp/shared/server/hash";
import {
  type FinalFile,
  finalKey,
  ObjectAlreadyExistsError,
  type ObjectStorage,
} from "@fmerp/storage";
import { eq, sql } from "drizzle-orm";
import { loadPackageData } from "./load";
import { buildPdfHtml } from "./pdf-html";

/** 이미 있는 `final/` 객체의 내용이 다시 만든 내용과 달라 사람이 확인해야 한다 */
export class PackageConflictError extends Error {
  constructor(readonly key: string) {
    super(`완료 패키지 객체의 내용이 다릅니다 (덮어쓰지 않음): ${key}`);
  }
}

export interface GenerateDeps {
  db: Db;
  /** 서명·도장 이미지 키를 읽는 인증 DB 연결 (앱 DB 역할은 그 컬럼을 읽을 수 없다) */
  authDb: Db;
  storage: ObjectStorage;
  /** HTML을 PDF 바이트로 바꾼다 (worker가 Playwright로 구현) */
  renderPdf: (html: string) => Promise<Uint8Array>;
  /** `@font-face` CSS */
  fontCss?: string;
  now?: () => Date;
}

export interface GenerateResult {
  manifestHash: string;
  /** 이미 완성된 패키지라 아무것도 쓰지 않았다 */
  alreadyReady: boolean;
}

const utf8 = (text: string) => new TextEncoder().encode(text);

/** 객체를 한 번만 쓴다. 이미 있으면 내용(해시)이 같을 때만 성공으로 본다 */
async function putOnce(
  storage: ObjectStorage,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  try {
    await storage.putIfAbsent(key, bytes, contentType);
  } catch (error) {
    if (!(error instanceof ObjectAlreadyExistsError)) throw error;
    const existing = await storage.getBytes(key);
    if (sha256Hex(existing) !== sha256Hex(bytes)) throw new PackageConflictError(key);
  }
}

export async function generatePackage(
  deps: GenerateDeps,
  input: { accountId: string; documentId: string },
): Promise<GenerateResult> {
  const { db, storage } = deps;
  const { accountId, documentId } = input;
  const now = deps.now ?? (() => new Date());

  // 1) 읽기와 시도 기록
  const prepared = await withTenant(db, accountId, async (tx) => {
    await tx.insert(schema.documentPackage).values({ documentId, accountId }).onConflictDoNothing();
    const [pkg] = await tx
      .select()
      .from(schema.documentPackage)
      .where(eq(schema.documentPackage.documentId, documentId));
    if (pkg?.status === "READY" && pkg.manifestHash) {
      return { kind: "ready" as const, manifestHash: pkg.manifestHash };
    }
    await tx
      .update(schema.documentPackage)
      .set({ attempts: sql`${schema.documentPackage.attempts} + 1`, updatedAt: now() })
      .where(eq(schema.documentPackage.documentId, documentId));
    return {
      kind: "load" as const,
      data: await loadPackageData(tx, storage, deps.authDb, documentId),
    };
  });
  if (prepared.kind === "ready") return { manifestHash: prepared.manifestHash, alreadyReady: true };
  const data = prepared.data;

  try {
    // 2) 내용 만들기
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    const documentJson = utf8(
      canonicalJson(
        buildDocumentJson({
          documentId,
          docNo: data.doc.docNo,
          title: data.doc.title,
          businessCode: data.doc.businessCode,
          securityLevel: data.doc.securityLevel,
          urgent: data.doc.urgent,
          desiredDueDate: data.doc.desiredDueDate,
          submittedAt: iso(data.doc.submittedAt),
          form: {
            code: data.form.code,
            name: data.form.name,
            version: data.form.version,
            schema: data.form.schema,
          },
          values: data.values,
          revision: data.revision,
        }),
      ),
    );
    const approvalJson = utf8(
      canonicalJson(
        buildApprovalJson({
          documentId,
          docNo: data.doc.docNo,
          title: data.doc.title,
          contentHash: data.doc.contentHash,
          securityLevel: data.doc.securityLevel,
          status: data.doc.status,
          submittedAt: iso(data.doc.submittedAt),
          completedAt: iso(data.doc.completedAt),
          drafter: data.drafter,
          steps: data.steps,
          actions: data.actions,
          attachments: data.attachments,
          restore: data.restore,
        }),
      ),
    );

    // 3) 쓰기 순서: document.json → approval.json → document.pdf → manifest.json (manifest가 완성 표시)
    const key = (file: FinalFile) => finalKey(data.prefix, file);
    await putOnce(storage, key("document.json"), documentJson, "application/json");
    await putOnce(storage, key("approval.json"), approvalJson, "application/json");

    // PDF는 만들 때마다 바이트가 달라 다시 만들지 않는다: 이미 있으면 그것을 채택한다
    let pdf: Uint8Array;
    if (await storage.head(key("document.pdf"))) {
      pdf = await storage.getBytes(key("document.pdf"));
    } else {
      const drafterId = data.drafter.membershipId;
      const html = buildPdfHtml({
        title: data.doc.title,
        docNo: data.doc.docNo,
        businessName: data.doc.businessName,
        sealUri: data.images.seal,
        form: {
          name: data.form.name,
          schema: data.form.schema as FormSchema,
          layout: data.form.layout,
        },
        values: data.values,
        names: data.names,
        people: data.people,
        drafter: {
          ...data.drafter,
          signatureUri: data.images.signatures[drafterId] ?? null,
          stampUri: data.images.stamps[drafterId] ?? null,
        },
        approvers: data.approvers,
        submittedAt: iso(data.doc.submittedAt),
        completedAt: iso(data.doc.completedAt),
        contentHash: data.doc.contentHash,
        attachments: data.attachments.map((a) => ({ filename: a.filename, size: a.size })),
        fontCss: deps.fontCss,
        approvalLineMaxCells: data.approvalLineMaxCells,
      });
      pdf = await deps.renderPdf(html);
      try {
        await storage.putIfAbsent(key("document.pdf"), pdf, "application/pdf");
      } catch (error) {
        if (!(error instanceof ObjectAlreadyExistsError)) throw error;
        // 다른 작업이 먼저 썼다: 그 PDF를 채택한다
        pdf = await storage.getBytes(key("document.pdf"));
      }
    }

    const manifestBytes = utf8(
      canonicalJson(
        buildManifest({
          documentId,
          files: [
            {
              path: "document.json",
              size: documentJson.byteLength,
              sha256: sha256Hex(documentJson),
            },
            {
              path: "approval.json",
              size: approvalJson.byteLength,
              sha256: sha256Hex(approvalJson),
            },
            { path: "document.pdf", size: pdf.byteLength, sha256: sha256Hex(pdf) },
          ],
          attachments: data.attachments,
        }),
      ),
    );
    await putOnce(storage, key("manifest.json"), manifestBytes, "application/json");
    const manifestHash = sha256Hex(manifestBytes);

    // 4) 완료 표시
    await withTenant(db, accountId, async (tx) => {
      await tx
        .update(schema.documentPackage)
        .set({
          status: "READY",
          manifestHash,
          readyAt: now(),
          lastError: null,
          updatedAt: now(),
        })
        .where(eq(schema.documentPackage.documentId, documentId));
      await recordAudit(tx, {
        accountId,
        actorUserId: null,
        action: "document.package_ready",
        target: { type: "document", id: documentId, label: data.doc.title },
        result: "success",
        request: {},
      });
    });
    return { manifestHash, alreadyReady: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(db, accountId, (tx) =>
      tx
        .update(schema.documentPackage)
        .set({
          // 내용이 달라 덮어쓸 수 없는 경우는 재시도해도 소용없으니 FAILED로 두고 사람이 확인한다
          status: error instanceof PackageConflictError ? "FAILED" : "PENDING",
          lastError: message.slice(0, 500),
          updatedAt: now(),
        })
        .where(eq(schema.documentPackage.documentId, documentId)),
    );
    throw error;
  }
}

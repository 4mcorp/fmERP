// 색인 재구성 (PRD BAK-010 ②, M7 plan 6절): DB를 잃었을 때 마지막 덤프 이후 완료된 문서를 S3 완료 패키지로부터
// DB에 다시 등록한다. 쓰기는 앱 역할(RLS·트리거 적용)로 문서가 만들어지는 순서(초안 → 진행 중 → 완료)를 그대로 따라가므로
// 불변 트리거를 우회하지 않는다. 이미 있는 문서는 건너뛰고(멱등), 해시가 맞지 않는 패키지는 건드리지 않고 보고한다.
import { createHash } from "node:crypto";
import { recordAudit } from "@fmerp/audit";
import {
  extractSearchIndex,
  type FormSchema,
  parseDocNumberSeq,
  type RestoreInfo,
  seriesKey,
} from "@fmerp/core";
import { type Db, schema, type Tx, withTenant } from "@fmerp/db";
import type { ObjectStorage } from "@fmerp/storage";
import { eq, inArray, sql } from "drizzle-orm";
import { clip } from "./pg-tools";
import { PackageVerifyError, verifyPackage } from "./verify";

export interface ReindexDeps {
  /** 앱 역할(fmerp_app): RLS가 적용되고 불변 트리거가 그대로 동작한다 */
  appDb: Db;
  storage: ObjectStorage;
  now?: () => Date;
}

export interface ReindexOptions {
  accountId: string;
  /** true면 검증만 하고 DB에 쓰지 않는다 */
  dryRun?: boolean;
}

export interface ReindexResult {
  /** 찾은 완료 패키지 수 */
  scanned: number;
  /** DB에 이미 있어 건너뛴 문서 수 */
  existing: number;
  /** 되살린(드라이런이면 되살릴) 문서 */
  restored: string[];
  skipped: { documentId: string; reason: string }[];
}

const MANIFEST_SUFFIX = "final/manifest.json";
const BATCH = 200;

interface ApprovalJson {
  schemaVersion: number;
  documentId: string;
  docNo: string | null;
  title: string;
  contentHash: string | null;
  securityLevel: string;
  submittedAt: string | null;
  completedAt: string | null;
  drafter: { membershipId: string };
  steps: {
    id: string;
    seq: number;
    type: string;
    status: string;
    quorum: number | null;
    canFinalize: boolean;
  }[];
  actions: {
    stepId: string;
    actorMembershipId: string;
    onBehalfOfMembershipId: string | null;
    action: string;
    comment: string | null;
    ip: string | null;
    at: string;
    docHash: string | null;
  }[];
  attachments: {
    id: string;
    filename: string;
    key: string;
    size: number;
    sha256: string;
    mime: string;
  }[];
  restore?: RestoreInfo;
}

interface DocumentJson {
  urgent: boolean;
  desiredDueDate: string | null;
  values: Record<string, unknown>;
  revision: { n: number; key: string; sha256: string };
}

class Skip extends Error {}

const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const utf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** 패키지 한 건을 검증하고 읽는다. 맞지 않으면 Skip으로 이유를 알린다 */
async function loadPackage(deps: ReindexDeps, prefix: string, accountId: string) {
  const { storage } = deps;
  const { manifestBytes } = await verifyPackage(storage, prefix).catch((error: unknown) => {
    throw error instanceof PackageVerifyError ? new Skip(error.message) : error;
  });
  const approval = JSON.parse(
    utf8(await storage.getBytes(`${prefix}final/approval.json`)),
  ) as ApprovalJson;
  const document = JSON.parse(
    utf8(await storage.getBytes(`${prefix}final/document.json`)),
  ) as DocumentJson;
  if (!approval.restore || approval.schemaVersion < 2) {
    throw new Skip("패키지 형식 v1이라 색인을 다시 만들 정보(restore)가 없습니다");
  }
  if (approval.restore.accountId !== accountId) {
    throw new Skip("패키지 안의 계정이 경로의 계정과 다릅니다");
  }
  return { manifestBytes, approval, document };
}

/** 본문 리비전 객체(`revisions/{n}.json`)를 나열해 해시를 읽는다 */
async function loadRevisions(deps: ReindexDeps, prefix: string) {
  const out: { n: number; key: string; sha256: string; size: number }[] = [];
  for await (const o of deps.storage.list(`${prefix}revisions/`)) {
    const m = /\/revisions\/(\d+)\.json$/.exec(o.key);
    if (!m) continue;
    const { sha256, size } = await deps.storage.hashObject(o.key);
    out.push({ n: Number(m[1]), key: o.key, sha256, size });
  }
  return out.sort((a, b) => a.n - b.n);
}

async function restoreOne(
  deps: ReindexDeps,
  accountId: string,
  documentId: string,
  prefix: string,
  dryRun: boolean,
) {
  const pkg = await loadPackage(deps, prefix, accountId);
  const { approval, document, manifestBytes } = pkg;
  const restore = approval.restore as RestoreInfo;
  const revisions = await loadRevisions(deps, prefix);
  const latest = revisions[revisions.length - 1];
  if (!latest) throw new Skip("본문 리비전이 없습니다");
  if (latest.n !== document.revision.n || latest.sha256 !== document.revision.sha256) {
    throw new Skip("최신 본문 리비전이 document.json의 기록과 다릅니다");
  }
  if (dryRun) return;

  const now = (deps.now ?? (() => new Date()))();
  await withTenant(deps.appDb, accountId, async (tx: Tx) => {
    // 이 DB에 이미 있어야 하는 참조(조직·양식)를 먼저 확인해 이유를 알려 준다
    const [biz] = await tx
      .select({ id: schema.business.id })
      .from(schema.business)
      .where(eq(schema.business.id, restore.businessId));
    if (!biz) throw new Skip("사업자가 DB에 없습니다 (덤프 이후에 만든 사업자)");
    const memberIds = new Set<string>([approval.drafter.membershipId]);
    for (const s of restore.steps) for (const id of s.assigneeIds) memberIds.add(id);
    for (const a of approval.actions) {
      memberIds.add(a.actorMembershipId);
      if (a.onBehalfOfMembershipId) memberIds.add(a.onBehalfOfMembershipId);
    }
    const found = await tx
      .select({ id: schema.membership.id })
      .from(schema.membership)
      .where(inArray(schema.membership.id, [...memberIds]));
    if (found.length !== memberIds.size)
      throw new Skip("구성원이 DB에 없습니다 (덤프 이후에 만든 구성원)");
    const [version] = await tx
      .select({ schema: schema.formVersion.schema, category: schema.form.category })
      .from(schema.formVersion)
      .innerJoin(schema.form, eq(schema.form.id, schema.formVersion.formId))
      .where(eq(schema.formVersion.id, restore.formVersionId));
    if (!version) throw new Skip("양식 버전이 DB에 없습니다 (덤프 이후에 만든 양식)");

    const index = extractSearchIndex(version.schema as unknown as FormSchema, document.values);
    const drafter = approval.drafter.membershipId;

    // 초안으로 만들고, 리비전·첨부·결재선을 붙인 뒤, 진행 중 → 완료 순서로 올린다 (문서가 만들어진 순서 그대로)
    await tx.insert(schema.document).values({
      id: documentId,
      accountId,
      businessId: restore.businessId,
      drafterMembershipId: drafter,
      drafterSnapshot: restore.drafterSnapshot,
      title: approval.title,
      status: "DRAFT",
      policy: restore.policy as never,
      numbering: restore.numbering as never,
      docNo: approval.docNo,
      formCategory: version.category,
      contentHash: approval.contentHash,
      formVersionId: restore.formVersionId,
      securityLevel: approval.securityLevel as never,
      urgent: document.urgent,
      desiredDueDate: document.desiredDueDate,
      amount: index.amount,
      latestRevision: 0,
      submittedAt: approval.submittedAt ? new Date(approval.submittedAt) : null,
      createdAt: new Date(restore.createdAt),
    });
    for (const r of revisions) {
      await tx.insert(schema.documentRevision).values({
        accountId,
        documentId,
        n: r.n,
        storageKey: r.key,
        sha256: r.sha256,
        size: r.size,
        savedByMembershipId: drafter,
      });
    }
    await tx
      .update(schema.document)
      .set({ latestRevision: latest.n })
      .where(eq(schema.document.id, documentId));
    for (const a of approval.attachments) {
      await tx.insert(schema.attachment).values({
        id: a.id,
        accountId,
        documentId,
        storageKey: a.key,
        filename: a.filename,
        size: a.size,
        mime: a.mime,
        sha256: a.sha256,
        uploadedByMembershipId: drafter,
      });
    }
    const stepById = new Map(approval.steps.map((s) => [s.id, s]));
    for (const rs of restore.steps) {
      const s = stepById.get(rs.id);
      if (!s) throw new Skip(`결재 단계 정보가 approval.json에 없습니다: ${rs.id}`);
      await tx.insert(schema.approvalStep).values({
        id: rs.id,
        accountId,
        documentId,
        seq: s.seq,
        type: s.type as never,
        assigneeIds: rs.assigneeIds,
        assigneeSnapshot: rs.assigneeSnapshot,
        delegates: rs.delegates,
        canFinalize: s.canFinalize,
        quorum: s.quorum,
        status: "PENDING",
        version: rs.version,
      });
    }
    await tx
      .update(schema.document)
      .set({ status: "IN_PROGRESS" })
      .where(eq(schema.document.id, documentId));
    for (const [i, a] of approval.actions.entries()) {
      await tx.insert(schema.approvalAction).values({
        accountId,
        documentId,
        stepId: a.stepId,
        actorMembershipId: a.actorMembershipId,
        onBehalfOfMembershipId: a.onBehalfOfMembershipId,
        action: a.action,
        comment: a.comment,
        idempotencyKey: `restore:${a.stepId}:${i + 1}`,
        docHash: a.docHash,
        ip: a.ip,
        createdAt: new Date(a.at),
      });
    }
    for (const s of approval.steps) {
      if (s.status !== "PENDING") {
        await tx
          .update(schema.approvalStep)
          .set({ status: s.status as never })
          .where(eq(schema.approvalStep.id, s.id));
      }
    }
    await tx
      .update(schema.document)
      .set({
        status: "COMPLETED",
        completedAt: approval.completedAt ? new Date(approval.completedAt) : now,
      })
      .where(eq(schema.document.id, documentId));

    await tx.insert(schema.documentPackage).values({
      documentId,
      accountId,
      status: "READY",
      attempts: 1,
      manifestHash: sha256Of(manifestBytes),
      readyAt: now,
    });
    await tx
      .insert(schema.documentSearch)
      .values({ documentId, accountId, body: index.text })
      .onConflictDoNothing();

    // 문서번호 시리즈: 이미 쓴 번호 이후로 맞춘다 (그러지 않으면 새 문서가 같은 번호를 다시 받는다)
    const numbering = restore.numbering as {
      rule: string;
      cycle: "year" | "month" | "none";
      at: string;
      departmentCode: string;
      formCode: string;
    } | null;
    if (numbering && approval.docNo) {
      const at = numbering.at === "submit" ? approval.submittedAt : approval.completedAt;
      const ctx = {
        businessCode: restore.businessCode,
        departmentCode: numbering.departmentCode,
        formCode: numbering.formCode,
        date: new Date(at ?? approval.completedAt ?? now),
      };
      const seq = parseDocNumberSeq(numbering.rule, ctx, approval.docNo);
      if (seq !== null) {
        await tx
          .insert(schema.docNumberSeries)
          .values({
            accountId,
            businessId: restore.businessId,
            key: seriesKey(numbering.rule, ctx, numbering.cycle),
            lastSeq: seq,
          })
          .onConflictDoUpdate({
            target: [schema.docNumberSeries.businessId, schema.docNumberSeries.key],
            set: { lastSeq: sql`greatest(${schema.docNumberSeries.lastSeq}, ${seq})` },
          });
      }
    }
    await recordAudit(tx, {
      accountId,
      actorUserId: null,
      action: "backup.reindex",
      target: { type: "document", id: documentId, label: approval.title },
      result: "success",
      reason: "S3 완료 패키지로 색인 재구성",
      request: {},
    });
  });
}

/** 한 계정의 S3 완료 패키지를 훑어 DB에 없는 문서를 되살린다 */
export async function reindexAccount(
  deps: ReindexDeps,
  options: ReindexOptions,
): Promise<ReindexResult> {
  const { accountId } = options;
  const result: ReindexResult = { scanned: 0, existing: 0, restored: [], skipped: [] };
  const found: { documentId: string; prefix: string }[] = [];
  for await (const o of deps.storage.list(`docs/${accountId}/`)) {
    if (!o.key.endsWith(`/${MANIFEST_SUFFIX}`)) continue;
    const prefix = o.key.slice(0, -MANIFEST_SUFFIX.length);
    const documentId = prefix.split("/").filter(Boolean).pop() ?? "";
    found.push({ documentId, prefix });
  }
  result.scanned = found.length;

  const present = new Set<string>();
  for (let i = 0; i < found.length; i += BATCH) {
    const ids = found.slice(i, i + BATCH).map((f) => f.documentId);
    const rows = await withTenant(deps.appDb, accountId, (tx) =>
      tx
        .select({ id: schema.document.id })
        .from(schema.document)
        .where(inArray(schema.document.id, ids)),
    );
    for (const r of rows) present.add(r.id);
  }

  for (const f of found) {
    if (present.has(f.documentId)) {
      result.existing += 1;
      continue;
    }
    try {
      await restoreOne(deps, accountId, f.documentId, f.prefix, options.dryRun === true);
      result.restored.push(f.documentId);
    } catch (error) {
      const reason =
        error instanceof Skip
          ? error.message
          : clip(error instanceof Error ? error.message : String(error));
      result.skipped.push({ documentId: f.documentId, reason });
    }
  }
  return result;
}

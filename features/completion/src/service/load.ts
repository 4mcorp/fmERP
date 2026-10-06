// 완료 패키지에 담을 데이터를 DB·S3에서 읽는다 (PRD BAK-003, APV-063). 호출자가 withTenant 트랜잭션을 연다.

import { type Db, schema, type Tx } from "@fmerp/db";
import type {
  AttachmentRef,
  PersonCard,
  RecordAction,
  RecordStep,
  RestoreInfo,
} from "@fmerp/shared/domain/completion-package";
import type { FormSchema } from "@fmerp/shared/domain/form-schema";
import { sha256Hex } from "@fmerp/shared/server/hash";
import { docPrefix, type ObjectStorage } from "@fmerp/storage";
import { asc, eq, inArray } from "drizzle-orm";
import type { PdfApprover } from "./pdf-html";

export interface PackageData {
  documentId: string;
  accountId: string;
  prefix: string;
  doc: {
    title: string;
    docNo: string | null;
    status: string;
    securityLevel: string;
    urgent: boolean;
    desiredDueDate: string | null;
    contentHash: string | null;
    submittedAt: Date | null;
    completedAt: Date | null;
    businessCode: string;
    businessName: string;
  };
  drafter: PersonCard;
  steps: RecordStep[];
  actions: RecordAction[];
  form: {
    code: string;
    name: string;
    version: number;
    schema: FormSchema;
    layout: Record<string, unknown>;
  };
  revision: { n: number; key: string; sha256: string };
  values: Record<string, unknown>;
  attachments: AttachmentRef[];
  names: Record<string, string>;
  approvers: PdfApprover[];
  images: {
    seal: string | null;
    signatures: Record<string, string>;
    stamps: Record<string, string>;
  };
  /** 색인 재구성용 DB 값 (approval.json의 restore 블록, BAK-010) */
  restore: RestoreInfo;
}

const STEP_LABEL: Record<string, string> = {
  approve: "결재",
  agree: "합의",
  cooperate: "협조",
  audit: "감사",
  post: "후결",
};
/** 단계를 처리 완료로 보게 하는 행위 */
const DONE_ACTIONS = new Set(["approve", "finalize", "agree", "audit_approve", "post_approve"]);

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function imageDataUri(bytes: Uint8Array): string | null {
  const b = bytes;
  let mime: string | null = null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) mime = "image/png";
  else if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) mime = "image/jpeg";
  else if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    mime = "image/webp";
  }
  if (!mime || bytes.byteLength > MAX_IMAGE_BYTES) return null;
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** 서명·도장·직인 이미지는 없어도 PDF를 만들 수 있다. 읽기에 실패하면 글자 결재란으로 대신한다 */
async function loadImage(storage: ObjectStorage, key: string | null): Promise<string | null> {
  if (!key) return null;
  try {
    return imageDataUri(await storage.getBytes(key));
  } catch {
    return null;
  }
}

const card = (snapshot: unknown, fallbackId: string): PersonCard => {
  const s = (snapshot ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  return {
    membershipId: text(s.membershipId) ?? fallbackId,
    name: text(s.name) ?? "(알 수 없음)",
    department: text(s.departmentName),
    position: text(s.positionName),
  };
};

export async function loadPackageData(
  tx: Tx,
  storage: ObjectStorage,
  authDb: Db,
  documentId: string,
): Promise<PackageData> {
  const [row] = await tx
    .select({
      doc: schema.document,
      businessCode: schema.business.code,
      businessName: schema.business.name,
      sealKey: schema.business.sealKey,
    })
    .from(schema.document)
    .innerJoin(schema.business, eq(schema.business.id, schema.document.businessId))
    .where(eq(schema.document.id, documentId));
  if (!row) throw new Error(`문서를 찾을 수 없습니다: ${documentId}`);
  const { doc } = row;
  if (doc.status !== "COMPLETED" || !doc.completedAt) {
    throw new Error(`완료된 문서가 아닙니다: ${documentId} (${doc.status})`);
  }
  if (!doc.formVersionId) {
    throw new Error(`양식 없이 만든 문서는 완료 패키지를 만들 수 없습니다: ${documentId}`);
  }

  const [version] = await tx
    .select({
      version: schema.formVersion.version,
      schema: schema.formVersion.schema,
      layout: schema.formVersion.layout,
      code: schema.form.code,
      name: schema.form.name,
    })
    .from(schema.formVersion)
    .innerJoin(schema.form, eq(schema.form.id, schema.formVersion.formId))
    .where(eq(schema.formVersion.id, doc.formVersionId));
  if (!version) throw new Error(`양식 버전을 찾을 수 없습니다: ${doc.formVersionId}`);

  const revisions = await tx
    .select()
    .from(schema.documentRevision)
    .where(eq(schema.documentRevision.documentId, documentId))
    .orderBy(asc(schema.documentRevision.n));
  const latest = revisions[revisions.length - 1];
  if (!latest) throw new Error(`저장된 본문이 없습니다: ${documentId}`);
  const bodyBytes = await storage.getBytes(latest.storageKey);
  if (sha256Hex(bodyBytes) !== latest.sha256) {
    throw new Error(`저장된 본문이 변경되었습니다 (무결성 오류): ${documentId}`);
  }
  const values = JSON.parse(new TextDecoder().decode(bodyBytes)) as Record<string, unknown>;

  const stepRows = await tx
    .select()
    .from(schema.approvalStep)
    .where(eq(schema.approvalStep.documentId, documentId))
    .orderBy(asc(schema.approvalStep.seq), asc(schema.approvalStep.id));
  const actionRows = await tx
    .select()
    .from(schema.approvalAction)
    .where(eq(schema.approvalAction.documentId, documentId))
    .orderBy(asc(schema.approvalAction.createdAt));
  const attachmentRows = await tx
    .select()
    .from(schema.attachment)
    .where(eq(schema.attachment.documentId, documentId));

  // 구성원 이름·서명·도장
  const memberIds = new Set<string>([doc.drafterMembershipId]);
  for (const a of actionRows) {
    memberIds.add(a.actorMembershipId);
    if (a.onBehalfOfMembershipId) memberIds.add(a.onBehalfOfMembershipId);
  }
  for (const s of stepRows) for (const id of s.assigneeIds) memberIds.add(id);
  for (const id of Object.values(values)) {
    for (const v of Array.isArray(id) ? id : [id]) {
      if (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)) memberIds.add(v);
    }
  }
  const members = memberIds.size
    ? await tx
        .select({
          id: schema.membership.id,
          name: schema.user.name,
          userId: schema.membership.userId,
        })
        .from(schema.membership)
        .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId))
        .where(inArray(schema.membership.id, [...memberIds]))
    : [];
  const departments = await tx
    .select({ id: schema.department.id, name: schema.department.name })
    .from(schema.department);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const names: Record<string, string> = Object.fromEntries([
    ...members.map((m) => [m.id, m.name] as const),
    ...departments.map((d) => [d.id, d.name] as const),
  ]);

  const steps: RecordStep[] = stepRows.map((s) => ({
    id: s.id,
    seq: s.seq,
    type: s.type,
    status: s.status,
    quorum: s.quorum,
    canFinalize: s.canFinalize,
    assignees: s.assigneeIds.map((id, i) => card(s.assigneeSnapshot[i], id)),
  }));
  const actions: RecordAction[] = actionRows.map((a) => ({
    stepId: a.stepId,
    actorMembershipId: a.actorMembershipId,
    actorName: nameOf.get(a.actorMembershipId) ?? "(알 수 없음)",
    onBehalfOfMembershipId: a.onBehalfOfMembershipId,
    onBehalfOfName: a.onBehalfOfMembershipId
      ? (nameOf.get(a.onBehalfOfMembershipId) ?? "(알 수 없음)")
      : null,
    action: a.action,
    comment: a.comment,
    ip: a.ip,
    at: a.createdAt.toISOString(),
    docHash: a.docHash,
  }));

  const images = {
    seal: await loadImage(storage, row.sealKey),
    signatures: {} as Record<string, string>,
    stamps: {} as Record<string, string>,
  };
  // 서명·도장 키는 앱 DB 역할이 읽을 수 없어 인증 DB 역할로 읽는다. 위에서 테넌트 범위로 거른 구성원만 조회한다
  const authKeys =
    members.length > 0
      ? await authDb
          .select({
            id: schema.user.id,
            signatureKey: schema.user.signatureKey,
            stampKey: schema.user.stampKey,
          })
          .from(schema.user)
          .where(
            inArray(
              schema.user.id,
              members.map((m) => m.userId),
            ),
          )
      : [];
  const keysOf = new Map(authKeys.map((k) => [k.id, k]));
  for (const m of members) {
    const keys = keysOf.get(m.userId);
    const sig = await loadImage(storage, keys?.signatureKey ?? null);
    const stamp = await loadImage(storage, keys?.stampKey ?? null);
    if (sig) images.signatures[m.id] = sig;
    if (stamp) images.stamps[m.id] = stamp;
  }

  // 결재란: 단계마다 실제로 처리한 사람(없으면 첫 처리자)
  const approvers: PdfApprover[] = steps.map((s) => {
    const done = actions.find((a) => a.stepId === s.id && DONE_ACTIONS.has(a.action));
    const assignee = s.assignees[0];
    const memberId = done?.actorMembershipId ?? assignee?.membershipId ?? "";
    return {
      stepId: s.id,
      type: s.type,
      label: STEP_LABEL[s.type] ?? s.type,
      name: done?.actorName ?? assignee?.name ?? "(알 수 없음)",
      position:
        s.assignees.find((p) => p.membershipId === (done?.onBehalfOfMembershipId ?? memberId))
          ?.position ?? assignee?.position,
      status: s.status,
      at: done?.at ?? null,
      onBehalfOfName: done?.onBehalfOfName ?? null,
      signatureUri: images.signatures[memberId] ?? null,
      stampUri: images.stamps[memberId] ?? null,
    };
  });

  return {
    documentId,
    accountId: doc.accountId,
    prefix: docPrefix(doc.accountId, row.businessCode, doc.createdAt, doc.id),
    doc: {
      title: doc.title,
      docNo: doc.docNo,
      status: doc.status,
      securityLevel: doc.securityLevel,
      urgent: doc.urgent,
      desiredDueDate: doc.desiredDueDate,
      contentHash: doc.contentHash,
      submittedAt: doc.submittedAt,
      completedAt: doc.completedAt,
      businessCode: row.businessCode,
      businessName: row.businessName,
    },
    drafter: card(doc.drafterSnapshot, doc.drafterMembershipId),
    steps,
    actions,
    form: {
      code: version.code,
      name: version.name,
      version: version.version,
      schema: version.schema as unknown as FormSchema,
      layout: version.layout,
    },
    revision: { n: latest.n, key: latest.storageKey, sha256: latest.sha256 },
    values,
    attachments: attachmentRows.map((a) => ({
      id: a.id,
      filename: a.filename,
      key: a.storageKey,
      size: a.size,
      sha256: a.sha256,
      mime: a.mime,
    })),
    names,
    approvers,
    images,
    restore: {
      accountId: doc.accountId,
      businessId: doc.businessId,
      businessCode: row.businessCode,
      formVersionId: doc.formVersionId,
      policy: doc.policy as unknown as Record<string, unknown>,
      numbering: (doc.numbering as unknown as Record<string, unknown> | null) ?? null,
      drafterSnapshot: doc.drafterSnapshot,
      createdAt: doc.createdAt.toISOString(),
      steps: stepRows.map((s) => ({
        id: s.id,
        assigneeIds: s.assigneeIds,
        delegates: s.delegates,
        assigneeSnapshot: s.assigneeSnapshot,
        version: s.version,
      })),
    },
  };
}

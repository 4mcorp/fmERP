// 상신 후 문서의 A4 출력 미리보기 HTML (계획 2.3, R6). 완료 PDF와 같은 생성기(buildPdfHtml)를 쓰고,
// 저장·S3 기록을 하지 않는다. 호출자가 withTenant 트랜잭션을 연다. 열람 확인은 requireView가 맡는다.
// 데이터를 읽는 규칙은 completion/src/service/load.ts와 같다(기능 간 import를 피하려고 여기에 둔다).

import { type Db, schema } from "@fmerp/db";
import { buildPdfHtml, type PdfApprover, type PdfInput } from "@fmerp/shared/domain/document-print";
import type { FormSchema } from "@fmerp/shared/domain/form-schema";
import type { ServiceContext } from "@fmerp/shared/server/context";
import { ServiceError } from "@fmerp/shared/server/errors";
import { sha256Hex } from "@fmerp/shared/server/hash";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { requireView, type Viewer } from "./access";

const STEP_LABEL: Record<string, string> = {
  approve: "결재",
  agree: "합의",
  cooperate: "협조",
  audit: "감사",
  post: "후결",
};
/** 단계를 처리 완료로 보게 하는 행위 (completion/load.ts와 같다) */
const DONE_ACTIONS = new Set(["approve", "finalize", "agree", "audit_approve", "post_approve"]);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

type Storage = ServiceContext["storage"];

function imageDataUri(b: Uint8Array): string | null {
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
  if (!mime || b.byteLength > MAX_IMAGE_BYTES) return null;
  return `data:${mime};base64,${Buffer.from(b).toString("base64")}`;
}

/** 이미지는 없어도 미리보기를 만들 수 있다. 읽기에 실패하면 글자 결재란으로 대신한다 */
async function loadImage(storage: Storage, key: string | null): Promise<string | null> {
  if (!key) return null;
  try {
    return imageDataUri(await storage.getBytes(key));
  } catch {
    return null;
  }
}

function personCard(snapshot: unknown, fallbackId: string) {
  const s = (snapshot ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  return {
    membershipId: text(s.membershipId) ?? fallbackId,
    name: text(s.name) ?? "(알 수 없음)",
    department: text(s.departmentName),
    position: text(s.positionName),
  };
}

/**
 * 상신한 문서의 A4 HTML. 완료 전이면 워터마크와 미결 칸으로 진행 상태를 보인다.
 * 열람할 수 없으면 404(not_found), 상신 전 문서는 409(invalid_state)다.
 */
export async function buildPrintPreview(
  ctx: ServiceContext,
  documentId: string,
  viewer: Viewer,
  authDb: Db,
): Promise<string> {
  await requireView(ctx, documentId, viewer);
  const { tx, storage } = ctx;

  const [row] = await tx
    .select({
      doc: schema.document,
      businessName: schema.business.name,
      sealKey: schema.business.sealKey,
      approvalLineMaxCells: schema.account.approvalLineMaxCells,
    })
    .from(schema.document)
    .innerJoin(schema.business, eq(schema.business.id, schema.document.businessId))
    .innerJoin(schema.account, eq(schema.account.id, schema.document.accountId))
    .where(eq(schema.document.id, documentId));
  if (!row) throw new ServiceError("not_found", "문서를 찾을 수 없습니다");
  const { doc } = row;
  if (!doc.submittedAt)
    throw new ServiceError("invalid_state", "상신한 뒤에 출력 미리보기를 열 수 있습니다");
  if (!doc.formVersionId) throw new ServiceError("not_found", "양식 없이 만든 문서입니다");

  const [version] = await tx
    .select({
      schema: schema.formVersion.schema,
      layout: schema.formVersion.layout,
      name: schema.form.name,
    })
    .from(schema.formVersion)
    .innerJoin(schema.form, eq(schema.form.id, schema.formVersion.formId))
    .where(eq(schema.formVersion.id, doc.formVersionId));
  if (!version) throw new ServiceError("not_found", "양식 버전을 찾을 수 없습니다");

  const [rev] = await tx
    .select()
    .from(schema.documentRevision)
    .where(eq(schema.documentRevision.documentId, documentId))
    .orderBy(desc(schema.documentRevision.n))
    .limit(1);
  if (!rev) throw new ServiceError("not_found", "저장된 본문이 없습니다");
  const bodyBytes = await storage.getBytes(rev.storageKey);
  if (sha256Hex(bodyBytes) !== rev.sha256) {
    throw new ServiceError("content_changed", "저장된 본문이 변경되었습니다 (무결성 오류)");
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
    .select({ filename: schema.attachment.filename, size: schema.attachment.size })
    .from(schema.attachment)
    .where(eq(schema.attachment.documentId, documentId));

  // 구성원 이름·서명·도장 (completion/load.ts와 같은 범위)
  const memberIds = new Set<string>([doc.drafterMembershipId]);
  for (const a of actionRows) {
    memberIds.add(a.actorMembershipId);
    if (a.onBehalfOfMembershipId) memberIds.add(a.onBehalfOfMembershipId);
  }
  for (const s of stepRows) for (const id of s.assigneeIds) memberIds.add(id);
  for (const v of Object.values(values)) {
    for (const x of Array.isArray(v) ? v : [v]) {
      if (typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)) memberIds.add(x);
    }
  }
  const members = await tx
    .select({
      id: schema.membership.id,
      name: schema.user.name,
      userId: schema.membership.userId,
    })
    .from(schema.membership)
    .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId))
    .where(inArray(schema.membership.id, [...memberIds]));
  const departments = await tx
    .select({ id: schema.department.id, name: schema.department.name })
    .from(schema.department);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const names: Record<string, string> = Object.fromEntries([
    ...members.map((m) => [m.id, m.name] as const),
    ...departments.map((d) => [d.id, d.name] as const),
  ]);

  const signatures: Record<string, string> = {};
  const stamps: Record<string, string> = {};
  // 서명·도장 키는 앱 DB 역할이 읽을 수 없어 인증 DB 역할로 읽는다
  const keys =
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
  const keysOf = new Map(keys.map((k) => [k.id, k]));
  for (const m of members) {
    const k = keysOf.get(m.userId);
    const sig = await loadImage(storage, k?.signatureKey ?? null);
    const stamp = await loadImage(storage, k?.stampKey ?? null);
    if (sig) signatures[m.id] = sig;
    if (stamp) stamps[m.id] = stamp;
  }

  const steps = stepRows.map((s) => ({
    id: s.id,
    type: s.type,
    status: s.status,
    assignees: s.assigneeIds.map((id, i) => personCard(s.assigneeSnapshot[i], id)),
  }));
  const actions = actionRows.map((a) => ({
    stepId: a.stepId,
    action: a.action,
    actorMembershipId: a.actorMembershipId,
    onBehalfOfMembershipId: a.onBehalfOfMembershipId,
    actorName: nameOf.get(a.actorMembershipId) ?? "(알 수 없음)",
    onBehalfOfName: a.onBehalfOfMembershipId
      ? (nameOf.get(a.onBehalfOfMembershipId) ?? "(알 수 없음)")
      : null,
    at: a.createdAt.toISOString(),
  }));

  // 결재란: 단계마다 실제로 처리한 사람(없으면 첫 지정자)
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
      signatureUri: signatures[memberId] ?? null,
      stampUri: stamps[memberId] ?? null,
    };
  });

  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const drafterId = doc.drafterMembershipId;
  const input: PdfInput = {
    title: doc.title,
    docNo: doc.docNo,
    businessName: row.businessName,
    sealUri: await loadImage(storage, row.sealKey),
    form: {
      name: version.name,
      schema: version.schema as unknown as FormSchema,
      layout: version.layout,
    },
    values,
    names,
    drafter: {
      ...personCard(doc.drafterSnapshot, drafterId),
      signatureUri: signatures[drafterId] ?? null,
      stampUri: stamps[drafterId] ?? null,
    },
    approvers,
    submittedAt: iso(doc.submittedAt),
    completedAt: iso(doc.completedAt),
    contentHash: doc.contentHash,
    attachments: attachmentRows.map((a) => ({ filename: a.filename, size: a.size })),
    approvalLineMaxCells: row.approvalLineMaxCells,
  };
  return buildPdfHtml(input);
}

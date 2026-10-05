// 통합 테스트용 시드 도우미 (완료 패키지 생성기와 worker 큐 시험이 함께 쓴다). 운영 코드에서는 가져오지 않는다.
import { type Db, schema, withTenant } from "@fmerp/db";
import type { ObjectStorage } from "@fmerp/storage";
import { eq, sql } from "drizzle-orm";
import { sha256Hex } from "./hash";

export interface SeedEnv {
  appDb: Db;
  authDb: Db;
  storage: ObjectStorage;
}

export interface SeedContext {
  accountId: string;
  otherAccountId: string;
  businessId: string;
  formVersionId: string;
  members: Record<string, string>;
}

/** 시드 계정(fourm-test)의 업무 id들을 읽는다 */
export async function loadSeedContext(env: SeedEnv): Promise<SeedContext> {
  const accounts = await env.authDb.select().from(schema.account);
  const accountId = accounts.find((a) => a.slug === "fourm-test")?.id ?? "";
  const otherAccountId = accounts.find((a) => a.slug === "other-company")?.id ?? "";
  const rows = await env.authDb
    .select({
      id: schema.membership.id,
      email: schema.user.email,
      accountId: schema.membership.accountId,
    })
    .from(schema.membership)
    .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId));
  const members = Object.fromEntries(
    rows.filter((m) => m.accountId === accountId).map((m) => [m.email, m.id]),
  );
  const businesses = await withTenant(env.appDb, accountId, (tx) =>
    tx.select().from(schema.business),
  );
  const [fv] = await withTenant(env.appDb, accountId, (tx) =>
    tx
      .select({ id: schema.formVersion.id })
      .from(schema.formVersion)
      .innerJoin(schema.form, eq(schema.form.id, schema.formVersion.formId))
      .where(eq(schema.form.code, "GENERAL")),
  );
  return {
    accountId,
    otherAccountId,
    businessId: businesses.find((b) => b.code === "FM")?.id ?? "",
    formVersionId: fv?.id ?? "",
    members,
  };
}

/** 문서·단계·처리 기록을 DB에 직접 만든다 (완료 상태). 본문 리비전은 S3에 쓴다 */
export async function seedCompletedDocument(
  env: SeedEnv,
  ctx: SeedContext,
  title = "완료 패키지 시험",
  values: Record<string, unknown> = { memo: "본문" },
  options: {
    attachment?: { filename: string; bytes: Uint8Array };
    /** 문서번호와 규칙을 함께 정한다 (색인 재구성의 시리즈 보정 시험) */
    docNo?: string;
    numbering?: Record<string, unknown>;
  } = {},
) {
  const { accountId, businessId, formVersionId, members } = ctx;
  const documentId = crypto.randomUUID();
  const drafter = members["member1@example.com"] ?? "";
  const approver = members["member2@example.com"] ?? "";
  const prefix = `docs/${accountId}/FM/2026/${documentId}/`;
  const bytes = new TextEncoder().encode(JSON.stringify(values));
  const revisionKey = `${prefix}revisions/1.json`;
  await env.storage.put(revisionKey, bytes, "application/json");
  await withTenant(env.appDb, accountId, async (tx) => {
    // 리비전과 결재선은 초안에서만 추가할 수 있어서 초안 → 진행 중 → 완료 순서로 만든다
    await tx.execute(sql`insert into document (id, account_id, business_id, drafter_membership_id, drafter_snapshot, title, status, policy,
        doc_no, numbering, form_version_id, content_hash, latest_revision, submitted_at, completed_at, created_at)
      values (${documentId}::uuid, ${accountId}::uuid, ${businessId}::uuid, ${drafter}::uuid,
        ${JSON.stringify({ membershipId: drafter, name: "박사원", departmentName: "재무팀", positionName: "사원" })}::jsonb,
        ${title}, 'DRAFT', '{"disagree":"reject","rejectTo":"drafter","auditCanReject":true}'::jsonb,
        ${options.docNo ?? `FM-T-2026-${Math.floor(Math.random() * 9000 + 1000)}`},
        ${options.numbering ? JSON.stringify(options.numbering) : null}::jsonb, ${formVersionId}::uuid, ${"c".repeat(64)}, 0,
        '2026-10-01T01:00:00Z', null, '2026-09-30T12:00:00Z')`);
    await tx.insert(schema.documentRevision).values({
      accountId,
      documentId,
      n: 1,
      storageKey: revisionKey,
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
      savedByMembershipId: drafter,
    });
    await tx.execute(sql`update document set latest_revision = 1 where id = ${documentId}::uuid`);
    // 첨부는 초안일 때만 붙일 수 있다
    if (options.attachment) {
      const { filename, bytes: file } = options.attachment;
      const key = `${prefix}attachments/seed_${filename}`;
      await env.storage.put(key, file, "application/octet-stream");
      await tx.insert(schema.attachment).values({
        accountId,
        documentId,
        storageKey: key,
        filename,
        size: file.byteLength,
        mime: "application/octet-stream",
        sha256: sha256Hex(file),
        uploadedByMembershipId: drafter,
      });
    }
    const [step] = await tx
      .insert(schema.approvalStep)
      .values({
        accountId,
        documentId,
        seq: 1,
        type: "approve",
        assigneeIds: [approver],
        assigneeSnapshot: [
          {
            membershipId: approver,
            name: "최대리",
            departmentName: "재무팀",
            positionName: "대리",
          },
        ],
        status: "PENDING",
      })
      .returning();
    await tx.execute(
      sql`update document set status = 'IN_PROGRESS' where id = ${documentId}::uuid`,
    );
    await tx.insert(schema.approvalAction).values({
      accountId,
      documentId,
      stepId: step?.id ?? "",
      actorMembershipId: approver,
      action: "approve",
      comment: "확인했습니다",
      idempotencyKey: crypto.randomUUID(),
      docHash: "c".repeat(64),
      ip: "203.0.113.5",
    });
    await tx.execute(
      sql`update approval_step set status = 'APPROVED' where id = ${step?.id}::uuid`,
    );
    await tx.execute(
      sql`update document set status = 'COMPLETED', completed_at = '2026-10-02T01:00:00Z' where id = ${documentId}::uuid`,
    );
  });
  return { documentId, prefix };
}

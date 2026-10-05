// 계정 전체 내보내기 (PRD BAK-009, M7 plan 3절). worker가 ZIP을 스트리밍으로 만들어 `exports/{계정}/{작업}.zip`에 올린다.
// 계정의 데이터는 모두 앱 역할(RLS 적용)로 읽어, 코드 실수로 다른 계정 데이터가 섞이는 일을 DB가 한 번 더 막는다.
// 백업 역할(fmerp_backup)은 작업 대기열을 계정과 무관하게 찾고 작업 상태를 갱신하는 데만 쓴다.
import { createHash } from "node:crypto";
import { PassThrough, Readable, Transform } from "node:stream";
import { recordAudit } from "@fmerp/audit";
import {
  buildExportManifest,
  csvCell,
  type ExportFileEntry,
  safeEntryName,
  toCsv,
} from "@fmerp/core";
import { type Db, schema, withTenant } from "@fmerp/db";
import type { ObjectStorage } from "@fmerp/storage";
import { docPrefix } from "@fmerp/storage";
import { ZipArchive } from "archiver";
import { and, asc, eq, or, type SQL, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { clip } from "./pg-tools";

export interface ExportDeps {
  /** 백업 역할(fmerp_backup): 작업 대기열 조회·상태 갱신 */
  pool: Pool;
  /** 앱 역할(fmerp_app): 계정 데이터 읽기·감사 로그 (RLS 적용) */
  appDb: Db;
  storage: ObjectStorage;
  now?: () => Date;
}

export type ExportOutcome =
  | { status: "READY"; id: string; key: string; size: number; sha256: string }
  | { status: "FAILED"; id: string; error: string }
  | { status: "BUSY" };

/** 내보내기 파일 보관 기간 (일). 만료되면 EXPIRED로 표시하고 파일은 버킷 수명 주기 규칙이 지운다 */
export const EXPORT_RETENTION_DAYS = 7;
const AUDIT_PAGE = 2000;

export const exportKey = (accountId: string, jobId: string) => `exports/${accountId}/${jobId}.zip`;

// ===== 대기열 =====
export interface ClaimedExport {
  id: string;
  accountId: string;
  requestedByMembershipId: string;
}

/** 대기 중인 내보내기 한 건을 선점한다 (계정과 무관하게 가장 오래된 것) */
export async function claimNextExport(pool: Pool): Promise<ClaimedExport | null> {
  const { rows } = await pool.query<{ id: string; account_id: string; requested_by: string }>(
    `update backup_job set status = 'RUNNING', started_at = now()
      where id = (select id from backup_job where status = 'QUEUED'
                   order by created_at limit 1 for update skip locked)
      returning id, account_id, requested_by_membership_id as requested_by`,
  );
  const row = rows[0];
  return row
    ? { id: row.id, accountId: row.account_id, requestedByMembershipId: row.requested_by }
    : null;
}

/** 중단돼 RUNNING으로 남은 내보내기를 실패로 닫는다 (남아 있으면 그 계정의 새 요청을 막는다) */
export async function failStaleExports(pool: Pool, olderThanMinutes: number): Promise<number> {
  const { rowCount } = await pool.query(
    `update backup_job
        set status = 'FAILED', finished_at = now(), error = '중단됨 (worker가 끝나기 전에 멈췄거나 재시작됨)'
      where status = 'RUNNING' and started_at < now() - ($1::int * interval '1 minute')`,
    [olderThanMinutes],
  );
  return rowCount ?? 0;
}

/** 보관 기간이 지난 내보내기를 만료로 표시한다 */
export async function expireExports(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `update backup_job set status = 'EXPIRED' where status = 'READY' and expires_at < now()`,
  );
  return rowCount ?? 0;
}

// ===== ZIP 작성 =====
const hashing = (onChunk: (chunk: Buffer) => void) =>
  new Transform({
    transform(chunk: Buffer, _enc, cb) {
      onChunk(chunk);
      cb(null, chunk);
    },
  });

/** 항목을 하나씩 순서대로 붙이고 경로·크기·SHA-256을 모은다 (동시에 많은 객체 연결을 열지 않는다) */
class ExportZip {
  readonly files: ExportFileEntry[] = [];

  constructor(readonly archive: ZipArchive) {}

  private async append(path: string, source: Readable | Buffer | string) {
    const hash = createHash("sha256");
    let size = 0;
    let body: Readable | Buffer | string = source;
    if (source instanceof Readable) {
      body = source.pipe(
        hashing((c) => {
          hash.update(c);
          size += c.length;
        }),
      );
      source.once("error", (e) => (body as Readable).destroy(e));
    } else {
      const buf = typeof source === "string" ? Buffer.from(source, "utf8") : source;
      hash.update(buf);
      size = buf.length;
    }
    const entry = new Promise<void>((resolve) => this.archive.once("entry", () => resolve()));
    this.archive.append(body as Readable | Buffer, { name: path });
    await entry;
    this.files.push({ path, size, sha256: hash.digest("hex") });
  }

  addBuffer(path: string, content: Buffer | string) {
    return this.append(path, content);
  }

  addStream(path: string, stream: Readable) {
    return this.append(path, stream);
  }
}

const cell = (v: unknown): string =>
  v === null || v === undefined
    ? ""
    : v instanceof Date
      ? v.toISOString()
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);

/** 표 하나를 JSON·CSV 두 파일로 낸다 */
async function addTable(
  zip: ExportZip,
  base: string,
  headers: string[],
  rows: Record<string, unknown>[],
) {
  await zip.addBuffer(`${base}.json`, `${JSON.stringify(rows, null, 2)}\n`);
  await zip.addBuffer(
    `${base}.csv`,
    toCsv(
      headers,
      rows.map((r) => headers.map((h) => cell(r[h]))),
    ),
  );
}

const keysOf = (rows: Record<string, unknown>[], fallback: string[]) =>
  rows[0] ? Object.keys(rows[0]) : fallback;

type AuditExportRow = {
  id: string;
  occurredAt: Date;
  actorUserId: string | null;
  actorName: string | null;
  onBehalfOfUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  subjectUserId: string | null;
  diff: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  result: string;
  reason: string | null;
};

const AUDIT_HEADERS = [
  "id",
  "occurredAt",
  "actorUserId",
  "actorName",
  "onBehalfOfUserId",
  "action",
  "targetType",
  "targetId",
  "targetLabel",
  "subjectUserId",
  "diff",
  "ip",
  "userAgent",
  "requestId",
  "result",
  "reason",
] as const;

/** 감사 로그를 오래된 순으로 쪽씩 읽는다 (키셋). 한 쪽마다 짧은 트랜잭션이라 큰 계정도 메모리·잠금 부담이 없다 */
async function* auditPages(db: Db, accountId: string): AsyncGenerator<AuditExportRow[]> {
  const A = schema.auditLog;
  // 커서는 시각을 마이크로초까지 문자열로 들고 있어야 한다. JS Date(밀리초)로 자르면 같은 시각의 행이 쪽마다 다시 읽힌다
  let cursor: { at: string; id: string } | null = null;
  for (;;) {
    const after = cursor;
    const rows: (AuditExportRow & { cursorAt: string })[] = await withTenant(db, accountId, (tx) =>
      tx
        .select({
          id: A.id,
          occurredAt: A.occurredAt,
          actorUserId: A.actorUserId,
          actorName: schema.user.name,
          onBehalfOfUserId: A.onBehalfOfUserId,
          action: A.action,
          targetType: A.targetType,
          targetId: A.targetId,
          targetLabel: A.targetLabel,
          subjectUserId: A.subjectUserId,
          diff: A.diff,
          ip: A.ip,
          userAgent: A.userAgent,
          requestId: A.requestId,
          result: A.result,
          reason: A.reason,
          cursorAt: sql<string>`to_char(${A.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(A)
        .leftJoin(schema.user, eq(schema.user.id, A.actorUserId))
        .where(
          after
            ? or(
                sql`${A.occurredAt} > ${after.at}::timestamptz`,
                and(
                  sql`${A.occurredAt} = ${after.at}::timestamptz`,
                  sql`${A.id} > ${after.id}::uuid`,
                ),
              )
            : undefined,
        )
        .orderBy(asc(A.occurredAt), asc(A.id))
        .limit(AUDIT_PAGE),
    );
    if (rows.length === 0) return;
    const last = rows[rows.length - 1] as (typeof rows)[number];
    cursor = { at: last.cursorAt, id: last.id };
    yield rows.map(({ cursorAt: _cursorAt, ...row }) => row);
    if (rows.length < AUDIT_PAGE) return;
  }
}

/** 감사 로그 JSON(배열)을 쪽 단위로 흘려보낸다 */
function auditJsonStream(db: Db, accountId: string): Readable {
  return Readable.from(
    (async function* () {
      yield "[\n";
      let first = true;
      for await (const page of auditPages(db, accountId)) {
        for (const row of page) {
          yield `${first ? "" : ",\n"}${JSON.stringify(row)}`;
          first = false;
        }
      }
      yield "\n]\n";
    })(),
  );
}

function auditCsvStream(db: Db, accountId: string): Readable {
  return Readable.from(
    (async function* () {
      yield `﻿${AUDIT_HEADERS.map(csvCell).join(",")}\r\n`;
      for await (const page of auditPages(db, accountId)) {
        let chunk = "";
        for (const row of page) {
          chunk += `${AUDIT_HEADERS.map((h) => csvCell(cell((row as Record<string, unknown>)[h]))).join(",")}\r\n`;
        }
        yield chunk;
      }
    })(),
  );
}

interface DocToExport {
  id: string;
  title: string;
  docNo: string | null;
  businessCode: string;
  createdAt: Date;
  completedAt: Date | null;
  drafterName: string | null;
}

/** ZIP 안 경로: 버킷 구조에서 `docs/{계정ID}/`만 뺀 `{사업자코드}/{YYYY}/{문서ID}/…` */
const zipPrefix = (accountId: string, doc: DocToExport) =>
  `docs/${docPrefix(accountId, doc.businessCode, doc.createdAt, doc.id).slice(`docs/${accountId}/`.length)}`;

async function loadAccountData(db: Db, accountId: string) {
  return withTenant(db, accountId, async (tx) => {
    const [account] = await tx
      .select({ id: schema.account.id, name: schema.account.name })
      .from(schema.account);
    const strip = <T extends Record<string, unknown>>(rows: T[], drop: string[]) =>
      rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k))));
    const members = await tx
      .select({
        membershipId: schema.membership.id,
        userId: schema.membership.userId,
        name: schema.user.name,
        email: schema.user.email,
        role: schema.membership.role,
        status: schema.membership.status,
        employeeNo: schema.membership.employeeNo,
        joinedAt: schema.membership.joinedAt,
        leftAt: schema.membership.leftAt,
      })
      .from(schema.membership)
      .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId));
    const reviews = await tx
      .select({
        id: schema.auditReview.id,
        period: schema.auditReview.period,
        reviewerName: schema.user.name,
        reviewedAt: schema.auditReview.reviewedAt,
        memo: schema.auditReview.memo,
        abnormal: schema.auditReview.abnormal,
        abnormalNote: schema.auditReview.abnormalNote,
      })
      .from(schema.auditReview)
      .innerJoin(
        schema.membership,
        eq(schema.membership.id, schema.auditReview.reviewerMembershipId),
      )
      .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId));

    // 완료 패키지가 준비된 문서만 내보낸다. 그 밖의 문서는 건수만 manifest에 적는다
    const docs = await tx
      .select({
        id: schema.document.id,
        title: schema.document.title,
        docNo: schema.document.docNo,
        businessCode: schema.business.code,
        createdAt: schema.document.createdAt,
        completedAt: schema.document.completedAt,
        drafterName: schema.user.name,
        status: schema.document.status,
        packageStatus: schema.documentPackage.status,
      })
      .from(schema.document)
      .innerJoin(schema.business, eq(schema.business.id, schema.document.businessId))
      .innerJoin(schema.membership, eq(schema.membership.id, schema.document.drafterMembershipId))
      .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId))
      .leftJoin(schema.documentPackage, eq(schema.documentPackage.documentId, schema.document.id))
      .orderBy(asc(schema.document.createdAt), asc(schema.document.id));
    const attachments = await tx
      .select({
        id: schema.attachment.id,
        documentId: schema.attachment.documentId,
        storageKey: schema.attachment.storageKey,
        filename: schema.attachment.filename,
        sha256: schema.attachment.sha256,
      })
      .from(schema.attachment);

    return {
      account,
      members: members as Record<string, unknown>[],
      reviews: reviews as Record<string, unknown>[],
      docs,
      attachments,
      tables: {
        businesses: strip(await tx.select().from(schema.business), ["sealKey"]),
        departments: (await tx.select().from(schema.department)) as Record<string, unknown>[],
        positions: (await tx.select().from(schema.position)) as Record<string, unknown>[],
        duties: (await tx.select().from(schema.duty)) as Record<string, unknown>[],
        assignments: (await tx.select().from(schema.assignment)) as Record<string, unknown>[],
        assignmentHistory: (await tx.select().from(schema.assignmentHistory)) as Record<
          string,
          unknown
        >[],
        roleGrants: (await tx.select().from(schema.roleGrant)) as Record<string, unknown>[],
        forms: (await tx.select().from(schema.form)) as Record<string, unknown>[],
        formVersions: (await tx.select().from(schema.formVersion)) as Record<string, unknown>[],
        lineTemplates: (await tx.select().from(schema.approvalLineTemplate)) as Record<
          string,
          unknown
        >[],
      },
    };
  });
}

/** 내보내기 한 건을 실행한다. 이미 선점한 작업(RUNNING)을 받는다 */
export async function runAccountExport(
  deps: ExportDeps,
  job: ClaimedExport,
): Promise<ExportOutcome> {
  const now = deps.now ?? (() => new Date());
  const { pool, appDb, storage } = deps;
  const key = exportKey(job.accountId, job.id);

  const [requester] = await withTenant(appDb, job.accountId, (tx) =>
    tx
      .select({ userId: schema.membership.userId })
      .from(schema.membership)
      .where(eq(schema.membership.id, job.requestedByMembershipId)),
  );
  const audit = (action: string, result: "success" | "failure", reason?: string) =>
    withTenant(appDb, job.accountId, (tx) =>
      recordAudit(tx, {
        accountId: job.accountId,
        actorUserId: requester?.userId ?? null,
        action,
        target: { type: "backup_job", id: job.id },
        result,
        reason,
        request: {},
      }),
    ).catch(() => undefined);

  const out = new PassThrough();
  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on("error", (error) => out.destroy(error));
  archive.pipe(out);
  const zipHash = createHash("sha256");
  let zipSize = 0;
  const counted = out.pipe(
    hashing((c) => {
      zipHash.update(c);
      zipSize += c.length;
    }),
  );
  out.once("error", (e) => counted.destroy(e));
  const upload = storage.putStream(key, counted, "application/zip");

  try {
    const data = await loadAccountData(appDb, job.accountId);
    if (!data.account) throw new Error("계정을 찾을 수 없습니다");
    const zip = new ExportZip(archive);
    const warnings: string[] = [];
    const counts: Record<string, number> = {};

    // 조직·양식 (JSON·CSV). 서명·도장 이미지는 담지 않는다
    await addTable(
      zip,
      "org/members",
      [
        "membershipId",
        "userId",
        "name",
        "email",
        "role",
        "status",
        "employeeNo",
        "joinedAt",
        "leftAt",
      ],
      data.members,
    );
    const tables: [string, Record<string, unknown>[], string[]][] = [
      ["org/businesses", data.tables.businesses, []],
      ["org/departments", data.tables.departments, []],
      ["org/positions", data.tables.positions, []],
      ["org/duties", data.tables.duties, []],
      ["org/assignments", data.tables.assignments, []],
      ["org/assignment_history", data.tables.assignmentHistory, []],
      ["org/role_grants", data.tables.roleGrants, []],
      ["forms/forms", data.tables.forms, []],
      ["forms/form_versions", data.tables.formVersions, []],
      ["forms/line_templates", data.tables.lineTemplates, []],
    ];
    for (const [base, rows, fallback] of tables) {
      await addTable(zip, base, keysOf(rows, fallback), rows);
      counts[base.split("/")[1] as string] = rows.length;
    }
    counts.members = data.members.length;

    // 감사 로그 (쪽 단위 스트리밍)와 월간 점검 기록
    await zip.addStream("audit/audit_log.json", auditJsonStream(appDb, job.accountId));
    await zip.addStream("audit/audit_log.csv", auditCsvStream(appDb, job.accountId));
    await addTable(
      zip,
      "audit/audit_review",
      ["id", "period", "reviewerName", "reviewedAt", "memo", "abnormal", "abnormalNote"],
      data.reviews,
    );

    // 문서: READY 완료 패키지가 있는 완료 문서만
    const attachmentsByDoc = new Map<string, typeof data.attachments>();
    for (const a of data.attachments) {
      const list = attachmentsByDoc.get(a.documentId) ?? [];
      list.push(a);
      attachmentsByDoc.set(a.documentId, list);
    }
    const exported: DocToExport[] = [];
    const excluded: Record<string, number> = {};
    let missing = 0;
    for (const d of data.docs) {
      if (d.status !== "COMPLETED" || d.packageStatus !== "READY") {
        const why = d.status !== "COMPLETED" ? d.status : `패키지 ${d.packageStatus ?? "없음"}`;
        excluded[why] = (excluded[why] ?? 0) + 1;
        continue;
      }
      const prefix = docPrefix(job.accountId, d.businessCode, d.createdAt, d.id);
      const base = zipPrefix(job.accountId, d);
      const objects: { key: string; path: string; expectedSha?: string }[] = [];
      for (const f of ["document.json", "approval.json", "document.pdf", "manifest.json"]) {
        objects.push({ key: `${prefix}final/${f}`, path: `${base}final/${f}` });
      }
      for await (const o of storage.list(`${prefix}post-approvals/`)) {
        objects.push({
          key: o.key,
          path: `${base}post-approvals/${o.key.slice(`${prefix}post-approvals/`.length)}`,
        });
      }
      for (const a of attachmentsByDoc.get(d.id) ?? []) {
        objects.push({
          key: a.storageKey,
          path: `${base}attachments/${a.id}_${safeEntryName(a.filename)}`,
          expectedSha: a.sha256,
        });
      }
      for (const o of objects) {
        let stream: Readable;
        try {
          stream = await storage.getStream(o.key);
        } catch {
          missing += 1;
          warnings.push(`누락: ${o.key}`);
          continue;
        }
        await zip.addStream(o.path, stream);
        const entry = zip.files[zip.files.length - 1];
        if (o.expectedSha && entry && entry.sha256 !== o.expectedSha) {
          warnings.push(`첨부 해시가 기록과 다릅니다: ${o.path}`);
        }
      }
      exported.push(d);
    }
    counts.documents = exported.length;
    counts.excludedDocuments = Object.values(excluded).reduce((a, b) => a + b, 0);
    counts.missingObjects = missing;

    // 문서 색인 (어떤 문서가 어느 경로에 있는지)
    const index = exported.map((d) => ({
      documentId: d.id,
      docNo: d.docNo,
      title: d.title,
      drafter: d.drafterName,
      businessCode: d.businessCode,
      completedAt: d.completedAt,
      path: zipPrefix(job.accountId, d),
    }));
    await addTable(
      zip,
      "docs/index",
      ["documentId", "docNo", "title", "drafter", "businessCode", "completedAt", "path"],
      index,
    );

    // manifest는 마지막에: 위에서 모은 모든 파일의 경로·크기·SHA-256
    const generatedAt = now().toISOString();
    const manifest = buildExportManifest({
      account: { id: data.account.id, name: data.account.name },
      generatedAt,
      files: zip.files,
      counts: { ...counts },
    });
    // 제외된 문서의 사유와 경고는 manifest 밖(내용 해시에 영향 없는) 별도 파일로 둔다
    await zip.addBuffer(
      "README.txt",
      [
        "4mERP 계정 내보내기",
        `생성: ${generatedAt}`,
        "",
        "- manifest.json: 이 ZIP의 모든 파일(README.txt·manifest.json 제외)의 경로·크기·SHA-256",
        "- docs/: 완료 패키지가 준비된 완료 문서(final/·post-approvals/·attachments/)와 색인(index.json·csv)",
        "- org/·forms/: 조직·양식 (JSON·CSV). 서명·도장 이미지는 담지 않습니다",
        "- audit/: 이 계정의 감사 로그와 월간 점검 기록",
        "",
        `제외된 문서: ${JSON.stringify(excluded)}`,
        warnings.length > 0 ? `경고:\n${warnings.join("\n")}` : "경고: 없음",
        "",
      ].join("\n"),
    );
    archive.append(manifest, { name: "manifest.json" });
    await new Promise<void>((resolve) => archive.once("entry", () => resolve()));
    await archive.finalize();
    await upload;

    const sha256 = zipHash.digest("hex");
    const verified = await storage.hashObject(key);
    if (verified.sha256 !== sha256 || verified.size !== zipSize) {
      throw new Error("업로드한 ZIP의 해시·크기가 만든 내용과 다릅니다");
    }
    const expiresAt = new Date(now().getTime() + EXPORT_RETENTION_DAYS * 86_400_000);
    await pool.query(
      `update backup_job
          set status = 'READY', finished_at = now(), size = $2, sha256 = $3, storage_key = $4, expires_at = $5
        where id = $1`,
      [job.id, zipSize, sha256, key, expiresAt],
    );
    await audit("account.export_ready", "success");
    return { status: "READY", id: job.id, key, size: zipSize, sha256 };
  } catch (error) {
    archive.abort();
    out.destroy();
    await upload.catch(() => undefined);
    const message = clip(error instanceof Error ? error.message : String(error));
    await pool.query(
      `update backup_job set status = 'FAILED', finished_at = now(), error = $2
        where id = $1 and status = 'RUNNING'`,
      [job.id, message],
    );
    await audit("account.export_ready", "failure", message);
    return { status: "FAILED", id: job.id, error: message };
  }
}

/** (테스트·운영 편의) 대기 중인 내보내기를 하나 선점해 실행한다. 없으면 null */
export async function runNextExport(deps: ExportDeps): Promise<ExportOutcome | null> {
  const job = await claimNextExport(deps.pool);
  return job ? runAccountExport(deps, job) : null;
}

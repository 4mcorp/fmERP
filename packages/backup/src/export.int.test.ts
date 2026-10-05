// M7 통합 테스트: 계정 전체 내보내기 ZIP (BAK-009) (실제 DB·S3, PDF 변환은 가짜)
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { generatePackage } from "@fmerp/completion";
import {
  loadSeedContext,
  type SeedContext,
  seedCompletedDocument,
} from "@fmerp/completion/test-support";
import { createDatabase } from "@fmerp/db";
import { ObjectStorage } from "@fmerp/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimNextExport,
  type ExportDeps,
  expireExports,
  failStaleExports,
  runNextExport,
} from "./export";

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name}이 없습니다`);
  return v;
};
const appDb = createDatabase(need("DATABASE_URL"));
const authDb = createDatabase(need("AUTH_DATABASE_URL"));
const backupDb = createDatabase(need("BACKUP_DATABASE_URL"));
const owner = createDatabase(need("MIGRATION_DATABASE_URL"));
const storage = new ObjectStorage({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "us-east-1",
  bucket: need("S3_BUCKET"),
  accessKeyId: need("S3_ACCESS_KEY_ID"),
  secretAccessKey: need("S3_SECRET_ACCESS_KEY"),
  forcePathStyle: true,
});
const deps = (): ExportDeps => ({ pool: backupDb.pool, appDb: appDb.db, storage });

let seed: SeedContext;
let ownerMembership = "";
let otherOwnerMembership = "";
const MARK = "m7.export";

let pdfCalls = 0;
const renderPdf = async () => new TextEncoder().encode(`%PDF-1.7 fake ${++pdfCalls}`);

/** ZIP 중앙 디렉터리를 읽어 항목을 풀어 준다 (테스트용 최소 구현. 저장·deflate만 지원) */
function readZip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP 끝 기록을 찾을 수 없습니다");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("중앙 디렉터리가 깨졌습니다");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const sha = (b: Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex");

async function queueExport(accountId: string, membershipId: string): Promise<string> {
  const { rows } = await owner.pool.query(
    "insert into backup_job (account_id, requested_by_membership_id) values ($1, $2) returning id",
    [accountId, membershipId],
  );
  return rows[0].id;
}
const closeActive = () =>
  owner.pool.query(
    "update backup_job set status = 'FAILED', finished_at = now(), error = 'test' where status in ('QUEUED','RUNNING')",
  );

/** DB에서 문서를 지운다. 불변 트리거는 소유자 권한으로 잠시 끈다 (이 테스트가 남긴 가짜 상태가 다른 시험을 흔들지 않게) */
async function dropDocument(documentId: string) {
  const c = await owner.pool.connect();
  try {
    await c.query("begin");
    await c.query("alter table document disable trigger user");
    await c.query("alter table approval_step disable trigger user");
    await c.query("alter table document_package disable trigger user");
    await c.query("delete from document_package where document_id = $1", [documentId]);
    await c.query("delete from approval_action where document_id = $1", [documentId]);
    await c.query("delete from document where id = $1", [documentId]);
    await c.query("alter table document enable trigger user");
    await c.query("alter table approval_step enable trigger user");
    await c.query("alter table document_package enable trigger user");
    await c.query("commit");
  } catch (error) {
    await c.query("rollback");
    throw error;
  } finally {
    c.release();
  }
}

async function download(key: string): Promise<Buffer> {
  return Buffer.from(await storage.getBytes(key));
}

beforeAll(async () => {
  seed = await loadSeedContext({ appDb: appDb.db, authDb: authDb.db, storage });
  ownerMembership = seed.members["owner@example.com"] ?? "";
  const other = await owner.pool.query(
    "select m.id from membership m join \"user\" u on u.id = m.user_id where u.email = 'owner-b@example.com'",
  );
  otherOwnerMembership = other.rows[0]?.id ?? "";
  if (!ownerMembership || !otherOwnerMembership) throw new Error("시드 소유자가 없습니다");
  await closeActive();
}, 60_000);

afterAll(async () => {
  await closeActive();
  await owner.pool.query("delete from audit_log where action like $1", [`${MARK}%`]);
  await owner.pool.query("delete from backup_job where account_id = any($1::uuid[])", [
    [seed.accountId, seed.otherAccountId],
  ]);
  await appDb.pool.end();
  await authDb.pool.end();
  await backupDb.pool.end();
  await owner.pool.end();
});

describe("계정 전체 내보내기 (BAK-009)", () => {
  it("완료 패키지·첨부·조직·양식·감사 로그를 ZIP으로 만들고 manifest 해시가 모든 파일과 일치한다", async () => {
    const env = { appDb: appDb.db, authDb: authDb.db, storage };
    const attachment = {
      filename: "영수증 ../위험.txt",
      bytes: new TextEncoder().encode("영수증 내용"),
    };
    const withPkg = await seedCompletedDocument(
      env,
      seed,
      "내보내기 대상 문서",
      { memo: "본문" },
      { attachment },
    );
    await generatePackage(
      { db: appDb.db, authDb: authDb.db, storage, renderPdf },
      { accountId: seed.accountId, documentId: withPkg.documentId },
    );
    // 패키지가 아직 없는 완료 문서는 제외된다
    await seedCompletedDocument(env, seed, "패키지 없는 문서");

    // 감사 로그가 한 쪽(2000건)을 넘어도 겹침·누락 없이 나오는지, 수식 주입이 막히는지 본다
    await owner.pool.query(
      `insert into audit_log (account_id, action, result, target_label)
       select $1, '${MARK}.bulk', 'success', case when g = 1 then '=cmd|''/C calc''!A0' else 'row ' || g end
         from generate_series(1, 2100) g`,
      [seed.accountId],
    );

    const jobId = await queueExport(seed.accountId, ownerMembership);
    const out = await runNextExport(deps());
    expect(out, JSON.stringify(out)).toMatchObject({ status: "READY", id: jobId });
    if (out?.status !== "READY") return;

    // 작업 이력과 객체
    const { rows } = await owner.pool.query("select * from backup_job where id = $1", [jobId]);
    expect(rows[0]).toMatchObject({
      status: "READY",
      storage_key: `exports/${seed.accountId}/${jobId}.zip`,
      sha256: out.sha256,
    });
    expect(Number(rows[0].size)).toBe(out.size);
    const days = (new Date(rows[0].expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
    expect(await storage.hashObject(out.key)).toEqual({ sha256: out.sha256, size: out.size });

    const zip = readZip(await download(out.key));
    const names = [...zip.keys()];
    for (const required of [
      "manifest.json",
      "README.txt",
      "org/members.json",
      "org/members.csv",
      "org/departments.json",
      "forms/forms.json",
      "audit/audit_log.json",
      "audit/audit_log.csv",
      "audit/audit_review.json",
      "docs/index.json",
    ]) {
      expect(names, required).toContain(required);
    }

    // 문서 파일: 버킷 구조에서 docs/{계정ID}/를 뺀 경로, 위험한 첨부 이름은 안전하게 바뀐다
    const base = `docs/FM/2026/${withPkg.documentId}/`;
    for (const f of ["document.json", "approval.json", "document.pdf", "manifest.json"]) {
      expect(names, f).toContain(`${base}final/${f}`);
    }
    const attName = names.find((n) => n.startsWith(`${base}attachments/`));
    expect(attName).toBeTruthy();
    // 이름 안의 ".."는 경로 이동이 아니다 (경로 구분자는 바뀌어 한 조각으로 남는다)
    expect(attName?.split("/")).not.toContain("..");
    expect(attName?.split("/")).toHaveLength(base.split("/").length + 1);
    expect(attName?.split("/").pop()).not.toContain("/");
    expect(zip.get(attName as string)?.toString("utf8")).toBe("영수증 내용");
    // 패키지 원본과 ZIP 안 파일이 같다
    expect(sha(zip.get(`${base}final/document.pdf`) as Buffer)).toBe(
      (await storage.hashObject(`${withPkg.prefix}final/document.pdf`)).sha256,
    );

    // manifest: 모든 파일의 경로·크기·해시가 실제와 일치 (README·manifest 자신 제외)
    const manifest = JSON.parse((zip.get("manifest.json") as Buffer).toString("utf8")) as {
      schemaVersion: number;
      account: { id: string };
      counts: Record<string, number>;
      files: { path: string; size: number; sha256: string }[];
    };
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.account.id).toBe(seed.accountId);
    expect(manifest.counts.documents).toBeGreaterThanOrEqual(1);
    expect(manifest.counts.excludedDocuments).toBeGreaterThanOrEqual(1);
    expect(manifest.files.map((f) => f.path)).not.toContain("manifest.json");
    for (const f of manifest.files) {
      const bytes = zip.get(f.path);
      expect(bytes, f.path).toBeTruthy();
      expect(bytes?.length, f.path).toBe(f.size);
      expect(sha(bytes as Buffer), f.path).toBe(f.sha256);
    }
    expect(manifest.files.length).toBe(names.length - 2);

    // 다른 계정 데이터·서명 키가 섞이지 않는다
    const members = (zip.get("org/members.json") as Buffer).toString("utf8");
    expect(members).toContain("owner@example.com");
    expect(members).not.toContain("owner-b@example.com");
    expect(names.some((n) => n.includes(seed.otherAccountId))).toBe(false);
    expect((zip.get("org/businesses.json") as Buffer).toString("utf8")).not.toContain("sealKey");

    // 감사 로그: 2000건 넘게 쪽으로 읽어도 겹침·누락 없음, CSV는 수식 주입 방어
    const audit = JSON.parse((zip.get("audit/audit_log.json") as Buffer).toString("utf8")) as {
      id: string;
      action: string;
    }[];
    expect(new Set(audit.map((a) => a.id)).size).toBe(audit.length);
    expect(audit.filter((a) => a.action === `${MARK}.bulk`)).toHaveLength(2100);
    const csv = (zip.get("audit/audit_log.csv") as Buffer).toString("utf8");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("'=cmd|");
    expect(csv).not.toMatch(/,=cmd\|/);

    // 요청한 계정의 감사 로그에 남는다
    const logged = await owner.pool.query(
      "select result from audit_log where account_id = $1 and action = 'account.export_ready' and target_id = $2",
      [seed.accountId, jobId],
    );
    expect(logged.rows).toEqual([{ result: "success" }]);
  }, 180_000);

  it("패키지는 READY인데 객체가 사라졌으면 경고로 남기고 계속한다", async () => {
    await closeActive();
    const env = { appDb: appDb.db, authDb: authDb.db, storage };
    const doc = await seedCompletedDocument(env, seed, "객체 누락 문서");
    // 객체를 만들지 않고 패키지만 READY로 표시한다
    await owner.pool.query(
      `insert into document_package (document_id, account_id, status, manifest_hash, ready_at)
       values ($1, $2, 'READY', $3, now()) on conflict (document_id) do update set status = 'READY', manifest_hash = $3, ready_at = now()`,
      [doc.documentId, seed.accountId, "a".repeat(64)],
    );
    await queueExport(seed.accountId, ownerMembership);
    const out = await runNextExport(deps());
    expect(out?.status).toBe("READY");
    if (out?.status !== "READY") return;
    const zip = readZip(await download(out.key));
    const manifest = JSON.parse((zip.get("manifest.json") as Buffer).toString("utf8")) as {
      counts: Record<string, number>;
    };
    expect(manifest.counts.missingObjects).toBeGreaterThanOrEqual(1);
    expect((zip.get("README.txt") as Buffer).toString("utf8")).toContain("누락:");
    // 객체 없이 READY로 표시한 가짜 패키지는 다른 시험(복구 리허설의 표본)에 남기지 않는다
    await dropDocument(doc.documentId);
  }, 180_000);

  it("첨부 키가 이 계정의 경로 밖을 가리키면 ZIP에 담지 않고 경고한다 (다층 방어)", async () => {
    await closeActive();
    const env = { appDb: appDb.db, authDb: authDb.db, storage };
    // 다른 계정의 객체를 가리키도록 DB 값이 잘못됐다고 가정한다
    const foreignKey = `docs/${seed.otherAccountId}/FM/2026/남의문서/attachments/비밀.txt`;
    await storage.put(foreignKey, "다른 회사의 비밀 내용");
    const doc = await seedCompletedDocument(
      env,
      seed,
      "외부 첨부 문서",
      { memo: "x" },
      {
        attachment: { filename: "내것.txt", bytes: new TextEncoder().encode("내 첨부") },
      },
    );
    await generatePackage(
      { db: appDb.db, authDb: authDb.db, storage, renderPdf },
      { accountId: seed.accountId, documentId: doc.documentId },
    );
    await owner.pool.query("update attachment set storage_key = $2 where document_id = $1", [
      doc.documentId,
      foreignKey,
    ]);

    await queueExport(seed.accountId, ownerMembership);
    const out = await runNextExport(deps());
    expect(out?.status).toBe("READY");
    if (out?.status !== "READY") return;
    const zip = readZip(await download(out.key));
    for (const [name, bytes] of zip) {
      expect(bytes.toString("utf8"), name).not.toContain("다른 회사의 비밀 내용");
    }
    expect([...zip.keys()].some((n) => n.includes(`${doc.documentId}/attachments/`))).toBe(false);
    expect((zip.get("README.txt") as Buffer).toString("utf8")).toContain("계정 경로 밖의 첨부");
    await dropDocument(doc.documentId);
  }, 180_000);

  it("대기열: 가장 오래된 요청부터, 동시에 선점해도 같은 작업을 두 번 잡지 않는다", async () => {
    await closeActive();
    const a = await queueExport(seed.accountId, ownerMembership);
    const b = await queueExport(seed.otherAccountId, otherOwnerMembership);
    const [x, y] = await Promise.all([
      claimNextExport(backupDb.pool),
      claimNextExport(backupDb.pool),
    ]);
    expect([x?.id, y?.id].sort()).toEqual([a, b].sort());
    expect(await claimNextExport(backupDb.pool)).toBeNull();
    await closeActive();
  });

  it("중단된 RUNNING은 실패로 닫고, 보관 기간이 지난 READY는 만료로 표시한다", async () => {
    await closeActive();
    await owner.pool.query("delete from backup_job where account_id = $1", [seed.accountId]);
    const stale = await queueExport(seed.accountId, ownerMembership);
    await owner.pool.query(
      "update backup_job set status = 'RUNNING', started_at = now() - interval '3 hours' where id = $1",
      [stale],
    );
    expect(await failStaleExports(backupDb.pool, 120)).toBeGreaterThanOrEqual(1);
    expect(
      (await owner.pool.query("select status, error from backup_job where id = $1", [stale]))
        .rows[0],
    ).toMatchObject({
      status: "FAILED",
    });

    const ready = await queueExport(seed.accountId, ownerMembership);
    await owner.pool.query("update backup_job set status = 'RUNNING' where id = $1", [ready]);
    await owner.pool.query(
      "update backup_job set status = 'READY', size = 1, sha256 = 'a', storage_key = 'k', expires_at = now() - interval '1 minute' where id = $1",
      [ready],
    );
    expect(await expireExports(backupDb.pool)).toBeGreaterThanOrEqual(1);
    expect(
      (await owner.pool.query("select status from backup_job where id = $1", [ready])).rows[0]
        .status,
    ).toBe("EXPIRED");
  });
});

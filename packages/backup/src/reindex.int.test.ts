// M7 통합 테스트: S3 완료 패키지로 DB 색인 재구성 (BAK-010 ②) (실제 DB·S3, PDF 변환은 가짜)
import { createHash } from "node:crypto";
import { generatePackage } from "@fmerp/completion";
import {
  loadSeedContext,
  type SeedContext,
  seedCompletedDocument,
} from "@fmerp/completion/test-support";
import { createDatabase } from "@fmerp/db";
import { ObjectStorage } from "@fmerp/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reindexAccount } from "./reindex";

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name}이 없습니다`);
  return v;
};
const appDb = createDatabase(need("DATABASE_URL"));
const authDb = createDatabase(need("AUTH_DATABASE_URL"));
const owner = createDatabase(need("MIGRATION_DATABASE_URL"));
const storage = new ObjectStorage({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "us-east-1",
  bucket: need("S3_BUCKET"),
  accessKeyId: need("S3_ACCESS_KEY_ID"),
  secretAccessKey: need("S3_SECRET_ACCESS_KEY"),
  forcePathStyle: true,
});
const deps = { appDb: appDb.db, storage };

let seed: SeedContext;
let pdf = 0;
const renderPdf = async () => new TextEncoder().encode(`%PDF-1.7 fake ${++pdf}`);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const env = () => ({ appDb: appDb.db, authDb: authDb.db, storage });

const NUMBERING = {
  rule: "{사업자코드}-{부서코드}-{YYYY}-{SEQ:4}",
  cycle: "year",
  at: "complete",
  departmentCode: "FIN",
  formCode: "GEN",
};

async function makeDoc(title: string, options: Parameters<typeof seedCompletedDocument>[4] = {}) {
  const doc = await seedCompletedDocument(env(), seed, title, { memo: `${title} 본문` }, options);
  await generatePackage(
    { db: appDb.db, authDb: authDb.db, storage, renderPdf },
    { accountId: seed.accountId, documentId: doc.documentId },
  );
  return doc;
}

/** DB에서 문서를 지운다 (DB를 잃은 상황). 불변 트리거는 소유자 권한으로 잠시 끈다 */
async function loseFromDb(documentId: string) {
  const c = await owner.pool.connect();
  try {
    await c.query("begin");
    await c.query("alter table document disable trigger user");
    await c.query("alter table approval_step disable trigger user");
    await c.query("delete from approval_action where document_id = $1", [documentId]);
    await c.query("delete from document where id = $1", [documentId]);
    await c.query("alter table document enable trigger user");
    await c.query("alter table approval_step enable trigger user");
    await c.query("commit");
  } catch (error) {
    await c.query("rollback");
    throw error;
  } finally {
    c.release();
  }
}

async function snapshot(documentId: string) {
  const q = async (text: string) => (await owner.pool.query(text, [documentId])).rows;
  return {
    document: (
      await q(
        "select id, title, status, doc_no, content_hash, security_level, latest_revision, drafter_membership_id, business_id, form_version_id, submitted_at, completed_at, created_at, policy, numbering, drafter_snapshot from document where id = $1",
      )
    )[0],
    steps: await q(
      "select id, seq, type, status, assignee_ids, quorum, can_finalize, delegates, assignee_snapshot, version from approval_step where document_id = $1 order by seq, id",
    ),
    actions: await q(
      "select step_id, actor_membership_id, on_behalf_of_membership_id, action, comment, ip, doc_hash, created_at from approval_action where document_id = $1 order by created_at, step_id",
    ),
    revisions: await q(
      "select n, storage_key, sha256, size from document_revision where document_id = $1 order by n",
    ),
    attachments: await q(
      "select id, storage_key, filename, size, mime, sha256 from attachment where document_id = $1 order by id",
    ),
    search: (await q("select body from document_search where document_id = $1"))[0]?.body,
    pkg: (await q("select status, manifest_hash from document_package where document_id = $1"))[0],
  };
}

beforeAll(async () => {
  seed = await loadSeedContext({ appDb: appDb.db, authDb: authDb.db, storage });
});

afterAll(async () => {
  await owner.pool
    .query("delete from audit_log where action = 'backup.reindex'")
    .catch(() => undefined);
  await appDb.pool.end();
  await authDb.pool.end();
  await owner.pool.end();
});

describe("색인 재구성 (BAK-010 ②)", () => {
  it("DB에서 사라진 완료 문서를 S3 패키지로 되살리고 값이 원래와 같다 (멱등, 시리즈 보정 포함)", async () => {
    const attachment = { filename: "영수증.txt", bytes: new TextEncoder().encode("영수증 내용") };
    const doc = await makeDoc("재구성 대상", {
      attachment,
      docNo: "FM-FIN-2026-0042",
      numbering: NUMBERING,
    });
    const before = await snapshot(doc.documentId);
    expect(before.document.status).toBe("COMPLETED");
    expect(before.pkg).toMatchObject({ status: "READY" });

    await loseFromDb(doc.documentId);
    await owner.pool.query("delete from doc_number_series where account_id = $1", [seed.accountId]);
    expect((await snapshot(doc.documentId)).document).toBeUndefined();

    // 드라이런: 검증만 하고 DB는 그대로
    const dry = await reindexAccount(deps, { accountId: seed.accountId, dryRun: true });
    expect(dry.restored).toContain(doc.documentId);
    expect((await snapshot(doc.documentId)).document).toBeUndefined();

    // 실제 재구성
    const result = await reindexAccount(deps, { accountId: seed.accountId });
    expect(result.restored).toContain(doc.documentId);
    const skippedForDoc = result.skipped.filter((s) => s.documentId === doc.documentId);
    expect(skippedForDoc).toEqual([]);

    const after = await snapshot(doc.documentId);
    expect(after.document).toEqual(before.document);
    expect(after.steps).toEqual(before.steps);
    expect(after.actions).toEqual(before.actions);
    expect(after.revisions).toEqual(before.revisions);
    expect(after.attachments).toEqual(before.attachments);
    // 검색 색인은 상신 때 만든다(시드 문서에는 없었다). 재구성은 본문에서 다시 만들어 둔다
    expect(typeof after.search).toBe("string");
    expect(after.pkg).toMatchObject({ status: "READY", manifest_hash: before.pkg.manifest_hash });
    // 패키지의 manifest 해시가 실제 manifest 객체와 같다
    expect(after.pkg.manifest_hash).toBe(
      sha(await storage.getBytes(`${doc.prefix}final/manifest.json`)),
    );

    // 문서번호 시리즈가 이미 쓴 번호(42) 이후로 맞춰진다
    const series = await owner.pool.query(
      "select key, last_seq from doc_number_series where account_id = $1",
      [seed.accountId],
    );
    expect(series.rows).toHaveLength(1);
    expect(series.rows[0]?.last_seq).toBe(42);
    expect(series.rows[0]?.key).toContain("FM-FIN-2026-#");

    // 두 번 해도 같다 (이미 있는 문서는 건너뛴다)
    const again = await reindexAccount(deps, { accountId: seed.accountId });
    expect(again.restored).not.toContain(doc.documentId);
    expect(again.existing).toBeGreaterThanOrEqual(1);
    expect((await snapshot(doc.documentId)).steps).toEqual(before.steps);

    // 감사 로그에 남는다
    const logged = await owner.pool.query(
      "select result from audit_log where action = 'backup.reindex' and target_id = $1",
      [doc.documentId],
    );
    expect(logged.rows).toEqual([{ result: "success" }]);
  }, 180_000);

  it("해시가 맞지 않는 패키지는 건드리지 않고 이유와 함께 보고한다", async () => {
    const doc = await makeDoc("변조된 패키지");
    await loseFromDb(doc.documentId);
    // 패키지 파일을 바꾼다 (테스트는 키를 덮어쓸 수 있는 연결을 쓴다. 앱은 final/을 덮어쓸 수 없다)
    await storage.put(`${doc.prefix}final/document.json`, '{"변조":true}', "application/json");
    const result = await reindexAccount(deps, { accountId: seed.accountId });
    expect(result.restored).not.toContain(doc.documentId);
    expect(result.skipped.find((s) => s.documentId === doc.documentId)?.reason).toMatch(
      /해시가 manifest와 다릅니다: document\.json/,
    );
    expect((await snapshot(doc.documentId)).document).toBeUndefined();
  }, 180_000);

  it("첨부 객체가 바뀌었으면 건너뛴다", async () => {
    const attachment = { filename: "원본.txt", bytes: new TextEncoder().encode("원본") };
    const doc = await makeDoc("첨부 변조", { attachment });
    const att = (await snapshot(doc.documentId)).attachments[0];
    await loseFromDb(doc.documentId);
    await storage.put(att.storage_key, "바뀐 내용");
    const result = await reindexAccount(deps, { accountId: seed.accountId });
    expect(result.skipped.find((s) => s.documentId === doc.documentId)?.reason).toMatch(
      /첨부 해시/,
    );
  }, 180_000);

  it("v1 형식(restore 정보 없음) 패키지는 건너뛰고 이유를 알린다", async () => {
    const doc = await makeDoc("옛 형식");
    const approvalKey = `${doc.prefix}final/approval.json`;
    const manifestKey = `${doc.prefix}final/manifest.json`;
    const approval = JSON.parse(
      new TextDecoder().decode(await storage.getBytes(approvalKey)),
    ) as Record<string, unknown>;
    approval.restore = undefined;
    approval.schemaVersion = 1;
    const approvalBytes = new TextEncoder().encode(JSON.stringify(approval));
    await storage.put(approvalKey, approvalBytes, "application/json");
    // manifest도 새 해시에 맞춰 일관되게 만든다 (해시 검사가 아니라 형식 검사에 걸리게)
    const manifest = JSON.parse(new TextDecoder().decode(await storage.getBytes(manifestKey))) as {
      files: { path: string; size: number; sha256: string }[];
    };
    const entry = manifest.files.find((f) => f.path === "approval.json");
    if (entry) {
      entry.size = approvalBytes.length;
      entry.sha256 = sha(approvalBytes);
    }
    await storage.put(manifestKey, JSON.stringify(manifest), "application/json");
    await loseFromDb(doc.documentId);
    const result = await reindexAccount(deps, { accountId: seed.accountId });
    expect(result.skipped.find((s) => s.documentId === doc.documentId)?.reason).toMatch(/v1/);
  }, 180_000);

  it("첨부 참조가 계정 경로 밖을 가리키는 패키지는 되살리지 않는다 (다층 방어)", async () => {
    const attachment = { filename: "내것.txt", bytes: new TextEncoder().encode("내 첨부") };
    const doc = await makeDoc("외부 첨부 참조", { attachment });
    const approvalKey = `${doc.prefix}final/approval.json`;
    const manifestKey = `${doc.prefix}final/manifest.json`;
    const approval = JSON.parse(new TextDecoder().decode(await storage.getBytes(approvalKey))) as {
      attachments: { key: string }[];
    };
    (approval.attachments[0] as { key: string }).key =
      `docs/${seed.otherAccountId}/FM/2026/남의문서/attachments/비밀.txt`;
    const approvalBytes = new TextEncoder().encode(JSON.stringify(approval));
    await storage.put(approvalKey, approvalBytes, "application/json");
    // manifest의 approval.json 해시를 새 내용에 맞춰 일관되게 만든다 (해시 검사가 아니라 경로 검사에 걸리게)
    const manifest = JSON.parse(new TextDecoder().decode(await storage.getBytes(manifestKey))) as {
      files: { path: string; size: number; sha256: string }[];
    };
    const entry = manifest.files.find((f) => f.path === "approval.json");
    if (entry) {
      entry.size = approvalBytes.length;
      entry.sha256 = sha(approvalBytes);
    }
    await storage.put(manifestKey, JSON.stringify(manifest), "application/json");
    await loseFromDb(doc.documentId);
    const result = await reindexAccount(deps, { accountId: seed.accountId });
    expect(result.restored).not.toContain(doc.documentId);
    expect(result.skipped.find((s) => s.documentId === doc.documentId)?.reason).toMatch(
      /계정 경로 밖/,
    );
  }, 180_000);

  it("다른 계정의 패키지는 건드리지 않는다", async () => {
    const result = await reindexAccount(deps, { accountId: seed.otherAccountId });
    // 다른 회사에는 완료 패키지가 없거나, 있어도 이 계정 경로에서만 찾는다
    expect(result.restored.every((id) => typeof id === "string")).toBe(true);
    const mine = await owner.pool.query(
      "select count(*)::int as n from document where account_id = $1 and id = any($2::uuid[])",
      [seed.otherAccountId, result.restored],
    );
    expect(mine.rows[0].n).toBe(result.restored.length);
  });
});

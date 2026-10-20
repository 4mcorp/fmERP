// M7 통합 테스트: 복구 리허설 (BAK-010 ①, DEPLOYMENT_PLAN 8.6) (실제 DB·S3, pg 도구는 DB 컨테이너 안에서 실행)

import { createDatabase } from "@fmerp/db";
import {
  loadSeedContext,
  type SeedContext,
  seedCompletedDocument,
} from "@fmerp/shared/testing/completed-document";
import { generateCompletedPackage as generatePackage } from "@fmerp/shared/testing/package-generator";
import { ObjectStorage } from "@fmerp/storage";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPair } from "../src/service/age";
import { runManualDumpNow } from "../src/service/dump";
import { type RehearseDeps, rehearseRestore } from "../src/service/rehearse";
import { assertDroppableScratchDb, testServerUrl } from "./test-db-url";

const CONTAINER = process.env.TEST_DB_CONTAINER ?? "fmerp-dev-postgres-test-1";
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

let seed: SeedContext;
let keys: { identity: string; recipient: string };
let dumpKey = "";
let doc: { documentId: string; prefix: string };
const MARK = `m7-rehearse-${Date.now().toString(36)}`;

const rehearseDeps = (): RehearseDeps => ({
  storage,
  // 임시 DB를 만들고 지우는 연결(호스트에서 접속하는 주소). 대상 서버는 TEST_DB_PORT로 정한다
  adminUrl: testServerUrl("postgres"),
  // pg_restore는 컨테이너 안에서 실행하므로 컨테이너 안에서 보이는 주소를 쓴다
  restoreTool: (db) => ({
    command: `docker exec -i -e PGPASSWORD=postgres ${CONTAINER} pg_restore`,
    url: `postgres://postgres:postgres@localhost:5432/${db}`,
  }),
  sourcePool: owner.pool,
});

/** 임시 DB는 만든 사람(관리 연결)만 지울 수 있다 */
async function dropDb(db: string) {
  assertDroppableScratchDb(db, "fmerp_rehearse_");
  const admin = new Client({ connectionString: testServerUrl("postgres") });
  await admin.connect();
  try {
    await admin.query(`drop database if exists "${db}" with (force)`);
  } finally {
    await admin.end();
  }
}

const databases = async () =>
  (
    await owner.pool.query("select datname from pg_database where datname like 'fmerp_rehearse_%'")
  ).rows.map((r) => r.datname as string);

beforeAll(async () => {
  seed = await loadSeedContext({ appDb: appDb.db, authDb: authDb.db, storage });
  keys = await generateKeyPair();
  await owner.pool.query(
    "update system_backup set status = 'FAILED', finished_at = now(), error = 'test' where status in ('QUEUED','RUNNING')",
  );
  doc = await seedCompletedDocument(
    { appDb: appDb.db, authDb: authDb.db, storage },
    seed,
    "리허설 문서",
  );
  await generatePackage(
    {
      db: appDb.db,
      authDb: authDb.db,
      storage,
      renderPdf: async () => new TextEncoder().encode("%PDF-1.7 fake"),
    },
    { accountId: seed.accountId, documentId: doc.documentId },
  );
  const out = await runManualDumpNow(
    {
      pool: backupDb.pool,
      authDb: authDb.db,
      storage,
      recipients: [keys.recipient],
      pgDump: {
        command: `docker exec -i -e PGPASSWORD=fmerp_backup_dev ${CONTAINER} pg_dump`,
        url: `postgres://fmerp_backup:fmerp_backup_dev@localhost:5432/${new URL(need("BACKUP_DATABASE_URL")).pathname.slice(1)}`,
      },
    },
    { note: MARK },
  );
  if (out.status !== "SUCCEEDED") throw new Error(`덤프 실패: ${JSON.stringify(out)}`);
  dumpKey = out.key;
}, 120_000);

afterAll(async () => {
  await owner.pool
    .query("delete from system_backup where note like $1", [`${MARK}%`])
    .catch(() => undefined);
  for (const db of await databases()) await dropDb(db).catch(() => undefined);
  await appDb.pool.end();
  await authDb.pool.end();
  await backupDb.pool.end();
  await owner.pool.end();
});

describe("복구 리허설 (BAK-010 ①)", () => {
  it("덤프를 임시 DB에 복원해 행 수를 견주고 완료 패키지 해시를 검증한 뒤 임시 DB를 지운다", async () => {
    const before = await databases();
    const report = await rehearseRestore(rehearseDeps(), {
      source: { key: dumpKey },
      identity: keys.identity,
      sample: 20,
    });
    expect(report.error).toBeUndefined();
    // 테스트 DB에는 다른 시험이 남긴 가짜 READY 패키지(객체 없음)가 섞여 있을 수 있어 리허설이 그것을 실패로 보고한다.
    // 그래서 전체 ok가 아니라 이 시험의 문서가 통과했는지와 ok가 결과와 일관된지를 본다
    expect(
      report.packages.failed.map((f) => f.documentId),
      JSON.stringify(report),
    ).not.toContain(doc.documentId);
    expect(report.ok).toBe(report.packages.failed.length === 0);
    // 복원된 표의 행 수가 운영 DB와 같다 (덤프 직후라 변경이 없다. 감사 로그는 이 덤프가 남긴 기록만큼 운영이 많다)
    expect(report.restored.document).toBe(report.source?.document);
    expect(report.documentCountMatches).toBe(true);
    for (const t of [
      "account",
      "membership",
      "department",
      "approval_step",
      "approval_action",
      "document_package",
    ] as const) {
      expect(report.restored[t], t).toBe(report.source?.[t]);
    }
    expect(report.restored.audit_log).toBeLessThanOrEqual(report.source?.audit_log ?? 0);
    expect(report.packages.checked).toBeGreaterThanOrEqual(1);
    // 임시 DB는 남지 않는다
    expect(report.kept).toBe(false);
    expect(await databases()).toEqual(before);
  }, 180_000);

  it("패키지가 변조돼 있으면 리허설이 실패로 보고한다", async () => {
    const key = `${doc.prefix}final/document.json`;
    const original = await storage.getBytes(key);
    await storage.put(key, '{"변조":true}', "application/json");
    try {
      const report = await rehearseRestore(rehearseDeps(), {
        source: { key: dumpKey },
        identity: keys.identity,
      });
      expect(report.ok).toBe(false);
      expect(report.packages.failed.map((f) => f.documentId)).toContain(doc.documentId);
      expect(report.packages.failed.find((f) => f.documentId === doc.documentId)?.reason).toMatch(
        /해시가 manifest와 다릅니다/,
      );
    } finally {
      // 시험이 바꾼 패키지를 원래대로 돌려 놓는다 (다른 시험이 같은 DB·S3를 쓴다)
      await storage.put(key, original, "application/json");
    }
  }, 180_000);

  it("다른 개인키로는 복원하지 못하고, 실패해도 임시 DB는 지워진다", async () => {
    const before = await databases();
    const wrong = await generateKeyPair();
    const report = await rehearseRestore(rehearseDeps(), {
      source: { key: dumpKey },
      identity: wrong.identity,
    });
    expect(report.ok).toBe(false);
    expect(report.error).toBeTruthy();
    expect(await databases()).toEqual(before);
  }, 180_000);

  it("keep이면 복원한 DB를 남긴다", async () => {
    const report = await rehearseRestore(rehearseDeps(), {
      source: { key: dumpKey },
      identity: keys.identity,
      keep: true,
      sample: 1,
    });
    expect(report.kept).toBe(true);
    expect(await databases()).toContain(report.database);
    await dropDb(report.database);
  }, 180_000);
});

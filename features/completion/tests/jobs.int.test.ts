// worker 큐·스윕 통합 테스트 (실제 DB·S3·pg-boss, PDF 변환은 가짜): 완료 문서에 패키지가 자동으로 만들어진다 (ADR 0009)

import { createDatabase, schema, withTenant } from "@fmerp/db";
import { loadSeedContext, seedCompletedDocument } from "@fmerp/shared/testing/completed-document";
import { finalKey, ObjectStorage } from "@fmerp/storage";
import { eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerPackageJobs, sweepPackages } from "../src/jobs/jobs";

const appDb = createDatabase(process.env.DATABASE_URL ?? "");
const authDb = createDatabase(process.env.AUTH_DATABASE_URL ?? "");
const storage = new ObjectStorage({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "us-east-1",
  bucket: process.env.S3_BUCKET ?? "",
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  forcePathStyle: true,
});
// 테스트 전용 스키마: 다른 파일의 pg-boss와 겹치지 않게 한다
const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL ?? "",
  schema: "pgboss_test_worker",
});

let rendered = 0;
const renderPdf = async () => {
  rendered += 1;
  return new TextEncoder().encode(`%PDF-1.7 fake ${rendered}`);
};

/**
 * 남은 작업을 비운다. `boss.start()` 직후의 백그라운드 유지보수와 겹치면 교착(deadlock detected)이 날 수 있어 몇 번 다시 시도한다
 */
async function clearJobs(b: PgBoss) {
  for (let attempt = 1; ; attempt++) {
    try {
      await b.deleteAllJobs();
      return;
    } catch (error) {
      if (attempt >= 5 || !String(error).includes("deadlock")) throw error;
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
}

beforeAll(async () => {
  boss.on("error", () => {});
  await boss.start();
  // 이전 실행이 남긴 작업(이미 지워진 문서를 가리켜 계속 재시도한다)이 새 작업을 밀어내지 않게, 워커를 붙이기 전에 비운다
  await clearJobs(boss);
  await registerPackageJobs(boss, appDb.pool, {
    db: appDb.db,
    authDb: authDb.db,
    storage,
    renderPdf,
  });
}, 120_000);

afterAll(async () => {
  await boss.stop({ graceful: false });
  await appDb.pool.end();
  await authDb.pool.end();
});

// 전체 통합 테스트를 병렬로 돌리면 다른 파일의 완료 문서까지 스윕이 집어 오래 걸릴 수 있어 넉넉히 기다린다
async function waitFor<T>(fn: () => Promise<T | null | false>, ms = 100_000): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("시간 안에 조건이 충족되지 않았습니다");
}

describe("패키지 큐와 스윕 (ADR 0009)", () => {
  it("완료됐지만 패키지가 없는 문서를 스윕이 찾아 큐에 넣고 worker가 패키지를 만든다", async () => {
    const env = { appDb: appDb.db, authDb: authDb.db, storage };
    const ctx = await loadSeedContext(env);
    const { documentId, prefix } = await seedCompletedDocument(env, ctx, "큐 시험");

    // 스윕은 20초 이상 지난 문서만 집으므로 완료 시각(2026-10-02)이 충분히 오래돼 바로 대상이 된다
    const queued = await sweepPackages(boss, appDb.pool);
    expect(queued).toBeGreaterThanOrEqual(1);

    const pkg = await waitFor(async () => {
      const [row] = await withTenant(appDb.db, ctx.accountId, (tx) =>
        tx
          .select()
          .from(schema.documentPackage)
          .where(eq(schema.documentPackage.documentId, documentId)),
      );
      return row?.status === "READY" ? row : null;
    });
    expect(pkg.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await storage.head(finalKey(prefix, "manifest.json"))).not.toBeNull();
  }, 120_000);

  it("스윕을 연달아 해도 같은 문서의 패키지는 한 번만 만들어진다", async () => {
    const env = { appDb: appDb.db, authDb: authDb.db, storage };
    const ctx = await loadSeedContext(env);
    const { documentId } = await seedCompletedDocument(env, ctx, "중복 시험");
    await sweepPackages(boss, appDb.pool);
    await sweepPackages(boss, appDb.pool);
    const pkg = await waitFor(async () => {
      const [row] = await withTenant(appDb.db, ctx.accountId, (tx) =>
        tx
          .select()
          .from(schema.documentPackage)
          .where(eq(schema.documentPackage.documentId, documentId)),
      );
      return row?.status === "READY" ? row : null;
    });
    // singletonKey로 큐에는 한 번만 들어가 시도 횟수가 1이다
    expect(pkg.attempts).toBe(1);
    // 완성된 문서는 이후 스윕에서 집히지 않는다
    await sweepPackages(boss, appDb.pool);
    await new Promise((r) => setTimeout(r, 1500));
    const [after] = await withTenant(appDb.db, ctx.accountId, (tx) =>
      tx
        .select()
        .from(schema.documentPackage)
        .where(eq(schema.documentPackage.documentId, documentId)),
    );
    expect(after?.attempts).toBe(1);
  }, 120_000);
});

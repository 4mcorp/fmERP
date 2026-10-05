// worker 백업 작업 통합 테스트 (실제 DB·S3·pg-boss, pg 도구는 DB 컨테이너 안에서 실행)
import { type BackupDeps, generateKeyPair } from "@fmerp/backup";
import { createDatabase } from "@fmerp/db";
import { ObjectStorage } from "@fmerp/storage";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BACKUP_AUTO, type BackupJobs, registerBackupJobs } from "./backup-jobs";

const CONTAINER = process.env.TEST_DB_CONTAINER ?? "fmerp-dev-postgres-test-1";
const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name}이 없습니다`);
  return v;
};
const MARK = `m7-worker-${Date.now().toString(36)}`;

const backupDb = createDatabase(need("BACKUP_DATABASE_URL"));
const authDb = createDatabase(need("AUTH_DATABASE_URL"));
const appDb = createDatabase(need("DATABASE_URL"));
const owner = createDatabase(need("MIGRATION_DATABASE_URL"));
const storage = new ObjectStorage({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "us-east-1",
  bucket: need("S3_BUCKET"),
  accessKeyId: need("S3_ACCESS_KEY_ID"),
  secretAccessKey: need("S3_SECRET_ACCESS_KEY"),
  forcePathStyle: true,
});
// 테스트 전용 스키마: 다른 파일의 pg-boss와 겹치지 않게 한다
const boss = new PgBoss({ connectionString: need("DATABASE_URL"), schema: "pgboss_test_backup" });

let jobs: BackupJobs;

async function waitFor<T>(fn: () => Promise<T | null | false>, ms = 40_000): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("시간 안에 조건이 충족되지 않았습니다");
}

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
  await clearJobs(boss);
  // 이전 실행이 남긴 활성 행을 닫고, 오늘 성공한 덤프가 있는 것으로 만들어 시작 시 보충 덤프가 돌지 않게 한다
  await owner.pool.query(
    "update system_backup set status = 'FAILED', finished_at = now(), error = 'test' where status in ('QUEUED','RUNNING')",
  );
  await owner.pool.query(
    `insert into system_backup (kind, status, note, finished_at, size, sha256, storage_key)
     values ('auto', 'SUCCEEDED', $1, now(), 1, 'x', 'k')`,
    [`${MARK} 기준`],
  );
  // 중단된 덤프(RUNNING)가 남아 있는 상태에서 시작한다
  await owner.pool.query(
    "insert into system_backup (kind, status, note, started_at) values ('auto', 'RUNNING', $1, now() - interval '1 hour')",
    [`${MARK} 중단`],
  );
  const keys = await generateKeyPair();
  const deps: BackupDeps = {
    pool: backupDb.pool,
    authDb: authDb.db,
    storage,
    recipients: [keys.recipient],
    pgDump: {
      command: `docker exec -i -e PGPASSWORD=fmerp_backup_dev ${CONTAINER} pg_dump`,
      url: "postgres://fmerp_backup:fmerp_backup_dev@localhost:5432/fmerp",
    },
  };
  jobs = await registerBackupJobs(boss, deps, { pool: backupDb.pool, appDb: appDb.db, storage });
}, 60_000);

afterAll(async () => {
  jobs?.stop();
  await boss.stop({ graceful: false });
  await owner.pool
    .query(
      "update system_backup set status = 'FAILED', finished_at = now(), error = 'test' where status in ('QUEUED','RUNNING')",
    )
    .catch(() => undefined);
  await owner.pool
    .query("delete from system_backup where note like $1", [`${MARK}%`])
    .catch(() => undefined);
  await backupDb.pool.end();
  await authDb.pool.end();
  await appDb.pool.end();
  await owner.pool.end();
});

describe("worker 백업 작업 (BAK-005·006)", () => {
  it("시작할 때 중단돼 RUNNING으로 남은 덤프를 실패로 닫는다", async () => {
    const { rows } = await owner.pool.query(
      "select status, error from system_backup where note = $1",
      [`${MARK} 중단`],
    );
    expect(rows[0].status).toBe("FAILED");
    expect(rows[0].error).toMatch(/중단됨/);
  });

  it("자동 덤프를 매일 03:00 KST로 예약한다", async () => {
    const schedules = await boss.getSchedules();
    const s = schedules.find((x) => x.name === BACKUP_AUTO);
    expect(s?.cron).toBe("0 3 * * *");
    expect(s?.timezone).toBe("Asia/Seoul");
  });

  it("관리 화면이 남긴 수동 덤프 요청(QUEUED)을 집어 처리한다", async () => {
    const { rows } = await appDb.pool.query(
      "insert into system_backup (kind, status, note) values ('manual', 'QUEUED', $1) returning id",
      [`${MARK} 수동`],
    );
    const id = rows[0].id;
    const done = await waitFor(async () => {
      const r = await owner.pool.query(
        "select status, storage_key, size from system_backup where id = $1",
        [id],
      );
      return r.rows[0]?.status === "SUCCEEDED" ? r.rows[0] : null;
    });
    expect(done.storage_key).toMatch(/^_system\/db-dumps\/manual\//);
    expect(await storage.head(done.storage_key)).toMatchObject({ size: Number(done.size) });
  }, 60_000);

  it("계정 내보내기 요청(QUEUED)을 집어 ZIP을 만들고 READY로 바꾼다 (덤프와 따로 돈다)", async () => {
    const acc = await owner.pool.query("select id from account where slug = 'fourm-test'");
    const mem = await owner.pool.query(
      "select m.id from membership m join \"user\" u on u.id = m.user_id where u.email = 'owner@example.com' and m.account_id = $1",
      [acc.rows[0].id],
    );
    await owner.pool.query(
      "update backup_job set status = 'FAILED', finished_at = now(), error = 'test' where status in ('QUEUED','RUNNING')",
    );
    const { rows } = await owner.pool.query(
      "insert into backup_job (account_id, requested_by_membership_id) values ($1, $2) returning id",
      [acc.rows[0].id, mem.rows[0].id],
    );
    const done = await waitFor(async () => {
      const r = await owner.pool.query(
        "select status, storage_key, size from backup_job where id = $1",
        [rows[0].id],
      );
      return r.rows[0]?.status === "READY" ? r.rows[0] : null;
    });
    expect(done.storage_key).toBe(`exports/${acc.rows[0].id}/${rows[0].id}.zip`);
    expect(await storage.head(done.storage_key)).toMatchObject({ size: Number(done.size) });
  }, 90_000);
});

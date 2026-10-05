// M7 통합 테스트: DB 덤프 → 암호화 → S3 → 복호화 → 빈 DB 복원 → 행 수 대조 (실제 DB·S3, pg 도구는 DB 컨테이너 안에서 실행)
// 호스트에 pg_dump·pg_restore가 없는 개발 PC를 위해 `docker exec`로 감싼다. 컨테이너를 못 찾으면 건너뛰지 않고 실패한다.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createDatabase } from "@fmerp/db";
import { ObjectStorage } from "@fmerp/storage";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptStream, generateKeyPair } from "./age";
import { type BackupDeps, runDump, runManualDumpNow } from "./dump";
import { type PgToolConfig, toolVersion } from "./pg-tools";
import { restoreDump } from "./restore";

const sh = promisify(execFile);
const CONTAINER = process.env.TEST_DB_CONTAINER ?? "fmerp-dev-postgres-test-1";
const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name}이 없습니다`);
  return v;
};

const MARK = `m7-dump-${Date.now().toString(36)}`;
const dockerTool = (tool: string, password: string) =>
  `docker exec -i -e PGPASSWORD=${password} ${CONTAINER} ${tool}`;
// 컨테이너 안에서 보이는 주소 (호스트의 55433이 아니라 5432)
const dumpConfig = (db = "fmerp"): PgToolConfig => ({
  command: dockerTool("pg_dump", "fmerp_backup_dev"),
  url: `postgres://fmerp_backup:fmerp_backup_dev@localhost:5432/${db}`,
});
const restoreConfig = (db: string): PgToolConfig => ({
  command: dockerTool("pg_restore", "postgres"),
  url: `postgres://postgres:postgres@localhost:5432/${db}`,
});

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

let keys: { identity: string; recipient: string };
const scratchDbs: string[] = [];

const deps = (over: Partial<BackupDeps> = {}): BackupDeps => ({
  pool: backupDb.pool,
  authDb: authDb.db,
  storage,
  recipients: [keys.recipient],
  pgDump: dumpConfig(),
  ...over,
});

const psql = (sqlText: string, db = "fmerp") =>
  sh("docker", [
    "exec",
    "-i",
    CONTAINER,
    "psql",
    "-U",
    "postgres",
    "-d",
    db,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sqlText,
  ]);

async function scratchClient(db: string) {
  const client = new Client({
    connectionString: `postgres://postgres:postgres@localhost:55433/${db}`,
  });
  await client.connect();
  return client;
}

const count = async (
  pool: { query: (q: string) => Promise<{ rows: { n: number }[] }> },
  table: string,
) => (await pool.query(`select count(*)::int as n from ${table}`)).rows[0]?.n ?? 0;

async function queueManual(note: string): Promise<string> {
  const { rows } = await appDbQuery(
    "insert into system_backup (kind, status, note) values ('manual', 'QUEUED', $1) returning id",
    [`${MARK} ${note}`],
  );
  return rows[0].id;
}
const appDbQuery = (q: string, params: unknown[] = []) => appDb.pool.query(q, params);

/** 테스트가 남긴 활성(QUEUED·RUNNING) 행을 닫아 다음 테스트를 막지 않게 한다 */
async function closeActive() {
  await owner.pool.query(
    "update system_backup set status = 'FAILED', finished_at = now(), error = 'test' where status in ('QUEUED','RUNNING')",
  );
}

beforeAll(async () => {
  keys = await generateKeyPair();
  // 컨테이너 안 pg_dump가 실행되는지 먼저 확인한다 (안 되면 이유를 알려 주고 실패)
  try {
    await toolVersion(dockerTool("pg_dump", "x"));
  } catch (error) {
    throw new Error(
      `DB 컨테이너(${CONTAINER})에서 pg_dump를 실행할 수 없습니다. \`pnpm env:up\`으로 컨테이너를 띄웠는지, docker가 PATH에 있는지 확인하세요. 원인: ${error}`,
    );
  }
  await closeActive();
}, 60_000);

afterAll(async () => {
  await closeActive();
  await owner.pool
    .query("delete from verification where identifier = 'm7-secret'")
    .catch(() => undefined);
  await owner.pool
    .query("delete from system_backup where note like $1", [`${MARK}%`])
    .catch(() => undefined);
  for (const db of scratchDbs) {
    await psql(`drop database if exists ${db} with (force)`, "postgres").catch(() => undefined);
  }
  await backupDb.pool.end();
  await authDb.pool.end();
  await appDb.pool.end();
  await owner.pool.end();
});

describe("DB 덤프 (BAK-005·006, AUD-023)", () => {
  it("수동 덤프: 암호화돼 S3에 올라가고, 복호화해 빈 DB에 복원하면 데이터가 같다 (감사 로그 포함, 세션·인증 토큰 제외)", async () => {
    // 세션·인증 토큰은 덤프에서 데이터를 뺀다
    await owner.pool.query(
      "insert into verification (identifier, value, expires_at) values ('m7-secret', 'secret-token', now() + interval '1 day')",
    );
    // 감사 로그가 덤프에 들어가는지 보려면 먼저 몇 건이 있어야 한다 (이 파일만 돌리면 비어 있다)
    await owner.pool.query(
      "insert into audit_log (action, result) values ('m7.test.seed', 'success'), ('m7.test.seed', 'success')",
    );
    const before = {
      account: await count(owner.pool, "account"),
      membership: await count(owner.pool, "membership"),
      department: await count(owner.pool, "department"),
      auditLog: await count(owner.pool, "audit_log"),
    };
    expect(before.auditLog).toBeGreaterThan(0);

    const id = await queueManual("복원 검증");
    const out = await runDump(deps(), { kind: "manual", systemBackupId: id, note: MARK });
    expect(out.status).toBe("SUCCEEDED");
    if (out.status !== "SUCCEEDED") return;

    // 이력: 크기·해시·키·도구 버전이 기록되고 객체와 일치한다
    const { rows } = await owner.pool.query("select * from system_backup where id = $1", [id]);
    expect(rows[0]).toMatchObject({
      status: "SUCCEEDED",
      storage_key: out.key,
      sha256: out.sha256,
    });
    expect(Number(rows[0].size)).toBe(out.size);
    expect(rows[0].pg_dump_version).toMatch(/pg_dump \(PostgreSQL\) 18/);
    expect(await storage.hashObject(out.key)).toEqual({ sha256: out.sha256, size: out.size });
    expect(out.key).toMatch(
      /^_system\/db-dumps\/manual\/\d{4}-\d{2}-\d{2}T\d{6}_[0-9a-f]{8}\.dump\.age$/,
    );

    // 서버가 가진 건 공개키뿐이라 올라간 파일은 평문 덤프가 아니라 age 암호문이다
    const head = new TextDecoder().decode(await storage.getRange(out.key, 0, 21));
    expect(head).toBe("age-encryption.org/v1\n");

    // 개인키로 복호화해 빈 DB에 복원
    const db = `m7_restore_${Date.now().toString(36)}`;
    scratchDbs.push(db);
    await psql(`create database ${db}`, "postgres");
    await restoreDump(
      restoreConfig(db),
      await decryptStream(await storage.getStream(out.key), keys.identity),
    );

    const restored = await scratchClient(db);
    try {
      const n = async (t: string) =>
        (await restored.query(`select count(*)::int as n from ${t}`)).rows[0].n as number;
      expect(await n("account")).toBe(before.account);
      expect(await n("membership")).toBe(before.membership);
      expect(await n("department")).toBe(before.department);
      // 감사 로그가 덤프에 들어 있다 (AUD-023). 덤프 시점 이후에 남긴 이 덤프의 감사 로그는 아직 없다
      expect(await n("audit_log")).toBe(before.auditLog);
      // 세션·인증 토큰 데이터는 제외, pg-boss 스키마도 제외
      expect(await n("verification")).toBe(0);
      expect(await n("session")).toBe(0);
      const boss = await restored.query(
        "select 1 from information_schema.schemata where schema_name = 'pgboss'",
      );
      expect(boss.rowCount).toBe(0);
    } finally {
      await restored.end();
    }

    // 이 덤프 자체가 감사 로그에 남는다 (계정 없는 시스템 행위)
    const audit = await owner.pool.query(
      "select result, target_id from audit_log where action = 'backup.dump' and target_id = $1",
      [id],
    );
    expect(audit.rows).toEqual([{ result: "success", target_id: id }]);
  }, 120_000);

  it("다른 개인키로는 복호화할 수 없다", async () => {
    const id = await queueManual("키 검증");
    const out = await runDump(deps(), { kind: "manual", systemBackupId: id });
    expect(out.status).toBe("SUCCEEDED");
    if (out.status !== "SUCCEEDED") return;
    const other = await generateKeyPair();
    const read = async () => {
      const plain = await decryptStream(await storage.getStream(out.key), other.identity);
      for await (const _chunk of plain) {
        // 끝까지 읽는다
      }
    };
    await expect(read()).rejects.toThrow();
  }, 120_000);

  it("자동 덤프는 직전 덤프 이후 변경이 없으면 건너뛰고, 변경이 생기면 다시 덤프한다", async () => {
    const mutate = async () => {
      const c = await owner.pool.connect();
      try {
        await c.query(
          "insert into audit_log (action, result) values ('m7.test.change', 'success')",
        );
        await c.query("select pg_stat_force_next_flush()");
      } finally {
        c.release();
      }
    };
    await mutate();
    const first = await runDump(deps(), { kind: "auto", note: MARK });
    expect(first, JSON.stringify(first)).toMatchObject({ status: "SUCCEEDED" });
    if (first.status === "SUCCEEDED")
      expect(first.key).toMatch(/\/daily\/\d{4}-\d{2}-\d{2}T\d{6}_[0-9a-f]{8}\.dump\.age$/);

    const second = await runDump(deps(), { kind: "auto", note: MARK });
    expect(second.status).toBe("SKIPPED");
    // 건너뛰어도 성공 신호로 센다: 이력에 SKIPPED가 남고 변경 토큰이 이어진다
    const third = await runDump(deps(), { kind: "auto", note: MARK });
    expect(third.status).toBe("SKIPPED");

    await mutate();
    const fourth = await runDump(deps(), { kind: "auto", note: MARK });
    expect(fourth, JSON.stringify(fourth)).toMatchObject({ status: "SUCCEEDED" });
  }, 180_000);

  it("실행 중이거나 요청 대기인 덤프가 있으면 다른 덤프는 시작하지 않는다", async () => {
    const queued = await queueManual("동시 실행");
    expect((await runDump(deps(), { kind: "auto", note: MARK })).status).toBe("BUSY");
    // 같은 요청을 두 번 처리하지도 않는다
    const first = await runDump(deps(), { kind: "manual", systemBackupId: queued });
    expect(first.status).toBe("SUCCEEDED");
    expect((await runDump(deps(), { kind: "manual", systemBackupId: queued })).status).toBe("BUSY");
  }, 120_000);

  it("pg_dump가 실패하면 FAILED로 기록하고 업로드하지 않는다", async () => {
    const id = await queueManual("실패");
    const out = await runDump(deps({ pgDump: dumpConfig("no_such_database") }), {
      kind: "manual",
      systemBackupId: id,
    });
    expect(out.status).toBe("FAILED");
    if (out.status === "FAILED") expect(out.error).toMatch(/pg_dump 실패/);
    const { rows } = await owner.pool.query(
      "select status, error, storage_key from system_backup where id = $1",
      [id],
    );
    expect(rows[0].status).toBe("FAILED");
    expect(rows[0].storage_key).toBeNull();
    const audit = await owner.pool.query(
      "select result from audit_log where action = 'backup.dump' and target_id = $1",
      [id],
    );
    expect(audit.rows).toEqual([{ result: "failure" }]);
  }, 120_000);

  it("공개키가 없으면 덤프하지 않고 실패로 기록한다", async () => {
    const id = await queueManual("키 없음");
    const out = await runDump(deps({ recipients: [] }), { kind: "manual", systemBackupId: id });
    expect(out.status).toBe("FAILED");
    if (out.status === "FAILED") expect(out.error).toMatch(/공개키/);
  }, 60_000);

  it("요청 행 없이 바로 실행하는 수동 덤프(운영자 CLI): 이력이 남고, 활성 덤프가 있으면 시작하지 않는다", async () => {
    const out = await runManualDumpNow(deps(), { note: `${MARK} CLI` });
    expect(out.status).toBe("SUCCEEDED");
    if (out.status === "SUCCEEDED") {
      const { rows } = await owner.pool.query(
        "select kind, status, note from system_backup where id = $1",
        [out.id],
      );
      expect(rows[0]).toEqual({ kind: "manual", status: "SUCCEEDED", note: `${MARK} CLI` });
    }
    await queueManual("활성");
    expect((await runManualDumpNow(deps(), { note: `${MARK} 중복` })).status).toBe("BUSY");
  }, 120_000);
});

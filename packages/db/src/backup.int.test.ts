// M7 통합 테스트: 덤프·내보내기 테이블의 권한·RLS·이력 보호·동시 실행 제한 (실제 DB)
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "./index";

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name}이 없습니다`);
  return v;
};
const app = createDatabase(need("DATABASE_URL"));
const backup = createDatabase(need("BACKUP_DATABASE_URL"));
const owner = createDatabase(need("MIGRATION_DATABASE_URL"));

const MARK = `m7-db-${Date.now().toString(36)}`;
let accountA = "";
let accountB = "";
let membershipA = "";

async function clean() {
  await owner.pool.query("delete from system_backup where note like $1", [`${MARK}%`]);
  await owner.pool.query("delete from backup_job where account_id = any($1::uuid[])", [
    [accountA, accountB],
  ]);
}

beforeAll(async () => {
  const accounts = await owner.pool.query<{ id: string; slug: string }>(
    "select id, slug from account where slug in ('fourm-test', 'other-company')",
  );
  accountA = accounts.rows.find((a) => a.slug === "fourm-test")?.id ?? "";
  accountB = accounts.rows.find((a) => a.slug === "other-company")?.id ?? "";
  const m = await owner.pool.query<{ id: string }>(
    "select id from membership where account_id = $1 limit 1",
    [accountA],
  );
  membershipA = m.rows[0]?.id ?? "";
  if (!accountA || !accountB || !membershipA) throw new Error("시드 계정이 없습니다");
  await clean();
});

afterAll(async () => {
  await clean();
  await app.pool.end();
  await backup.pool.end();
  await owner.pool.end();
});

const insertDump = (pool: typeof app.pool, status: string, note: string) =>
  pool.query<{ id: string }>(
    "insert into system_backup (kind, status, note) values ('manual', $1, $2) returning id",
    [status, `${MARK} ${note}`],
  );

describe("system_backup (시스템 덤프 이력)", () => {
  it("앱 역할은 요청(INSERT)·조회·삭제 표시만 하고 상태 갱신·삭제는 못 한다", async () => {
    const { rows } = await insertDump(app.pool, "QUEUED", "권한");
    const id = rows[0]?.id;
    expect(
      (await app.pool.query("select id from system_backup where id = $1", [id])).rowCount,
    ).toBe(1);
    await expect(
      app.pool.query("update system_backup set status = 'SUCCEEDED' where id = $1", [id]),
    ).rejects.toThrow(/permission denied/);
    await expect(app.pool.query("delete from system_backup where id = $1", [id])).rejects.toThrow(
      /permission denied/,
    );
    await app.pool.query("update system_backup set delete_requested_at = now() where id = $1", [
      id,
    ]);
    // 정리: 소유자 역할만 지울 수 있다 (테스트 정리용)
    await owner.pool.query("delete from system_backup where id = $1", [id]);
  });

  it("백업 역할이 상태를 갱신하고, 끝난 이력은 삭제 표시 말고는 바꿀 수 없다", async () => {
    const { rows } = await insertDump(app.pool, "QUEUED", "상태");
    const id = rows[0]?.id;
    await backup.pool.query(
      "update system_backup set status = 'RUNNING', started_at = now() where id = $1",
      [id],
    );
    await backup.pool.query(
      "update system_backup set status = 'SUCCEEDED', size = 10, sha256 = 'a', storage_key = 'k', finished_at = now() where id = $1",
      [id],
    );
    await expect(
      backup.pool.query("update system_backup set size = 99 where id = $1", [id]),
    ).rejects.toThrow(/바꿀 수 없습니다/);
    await expect(
      backup.pool.query("update system_backup set status = 'FAILED' where id = $1", [id]),
    ).rejects.toThrow(/바꿀 수 없습니다/);
    // 삭제 표시는 앱 역할도 할 수 있다
    await app.pool.query("update system_backup set delete_requested_at = now() where id = $1", [
      id,
    ]);
    const { rows: after } = await owner.pool.query(
      "select size, delete_requested_at from system_backup where id = $1",
      [id],
    );
    expect(Number(after[0].size)).toBe(10);
    expect(after[0].delete_requested_at).not.toBeNull();
    await backup.pool.query("select 1"); // 연결 유지 확인
  });

  it("성공한 덤프는 크기·해시·키가 있어야 한다", async () => {
    const { rows } = await insertDump(app.pool, "RUNNING", "제약");
    const id = rows[0]?.id;
    await expect(
      backup.pool.query("update system_backup set status = 'SUCCEEDED' where id = $1", [id]),
    ).rejects.toThrow(/system_backup_done/);
    await owner.pool.query("delete from system_backup where id = $1", [id]);
  });

  it("요청 대기·실행 중인 덤프는 동시에 하나만 있을 수 있다", async () => {
    await insertDump(app.pool, "QUEUED", "동시1");
    await expect(insertDump(app.pool, "RUNNING", "동시2")).rejects.toThrow(
      /system_backup_single_active/,
    );
    // 끝난 행은 제한과 무관하다
    await owner.pool.query(
      "update system_backup set status = 'FAILED' where note like $1 and status in ('QUEUED', 'RUNNING')",
      [`${MARK}%`],
    );
    await insertDump(app.pool, "QUEUED", "동시3");
  });
});

describe("backup_job (계정 내보내기)", () => {
  it("계정 사이에 격리된다 (RLS)", async () => {
    await clean();
    const insert = (accountId: string) =>
      "insert into backup_job (account_id, requested_by_membership_id) values ('" +
      accountId +
      "', '" +
      membershipA +
      "')";
    // 트랜잭션은 한 연결에서 이어서 실행해야 한다
    const asAccount = async (accountId: string, run: (c: PoolClient) => Promise<void>) => {
      const c = await app.pool.connect();
      try {
        await c.query("begin");
        await c.query("select set_config('app.account_id', $1, true)", [accountId]);
        await run(c);
      } finally {
        await c.query("rollback");
        c.release();
      }
    };
    await asAccount(accountA, async (c) => {
      await c.query(insert(accountA));
      expect((await c.query("select id from backup_job")).rowCount).toBe(1);
    });
    await owner.pool.query(insert(accountA));
    // 다른 계정 컨텍스트에서는 보이지 않고, 남의 계정으로 넣는 것도 거부된다
    await asAccount(accountB, async (c) => {
      expect((await c.query("select id from backup_job")).rowCount).toBe(0);
      await expect(c.query(insert(accountA))).rejects.toThrow(/row-level security/);
    });
    await clean();
  });

  it("앱 역할은 요청·조회만 하고 갱신·삭제는 못 한다. 백업 역할은 계정 경계를 넘어 읽고 갱신한다", async () => {
    await clean();
    await owner.pool.query(
      "insert into backup_job (account_id, requested_by_membership_id) values ($1, $2)",
      [accountA, membershipA],
    );
    await expect(app.pool.query("update backup_job set status = 'READY'")).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.pool.query("delete from backup_job")).rejects.toThrow(/permission denied/);
    // RLS를 우회하는 백업 역할은 대기 중인 작업을 계정과 무관하게 찾는다
    const queued = await backup.pool.query(
      "select id from backup_job where status = 'QUEUED' and account_id = $1",
      [accountA],
    );
    expect(queued.rowCount).toBe(1);
    await backup.pool.query(
      "update backup_job set status = 'RUNNING', started_at = now() where id = $1",
      [queued.rows[0].id],
    );
    await clean();
  });

  it("한 계정에서 대기·실행 중인 내보내기는 하나뿐이다", async () => {
    await clean();
    const ins = (acc: string) =>
      owner.pool.query(
        "insert into backup_job (account_id, requested_by_membership_id) values ($1, $2)",
        [acc, membershipA],
      );
    await ins(accountA);
    await expect(ins(accountA)).rejects.toThrow(/backup_job_single_active/);
    await clean();
  });

  it("완성된 내보내기는 만료로만 바뀌고 실패·만료 이력은 고정된다", async () => {
    await clean();
    const { rows } = await owner.pool.query(
      "insert into backup_job (account_id, requested_by_membership_id) values ($1, $2) returning id",
      [accountA, membershipA],
    );
    const id = rows[0].id;
    await expect(
      backup.pool.query("update backup_job set status = 'READY' where id = $1", [id]),
    ).rejects.toThrow(/backup_job_ready/);
    await backup.pool.query(
      "update backup_job set status = 'READY', size = 5, sha256 = 'a', storage_key = 'k', expires_at = now() + interval '7 days' where id = $1",
      [id],
    );
    await expect(
      backup.pool.query("update backup_job set size = 9 where id = $1", [id]),
    ).rejects.toThrow(/바꿀 수 없습니다|만료로만/);
    await expect(
      backup.pool.query("update backup_job set status = 'FAILED' where id = $1", [id]),
    ).rejects.toThrow(/만료로만/);
    await backup.pool.query("update backup_job set status = 'EXPIRED' where id = $1", [id]);
    await expect(
      backup.pool.query("update backup_job set status = 'READY' where id = $1", [id]),
    ).rejects.toThrow(/바꿀 수 없습니다/);
    await clean();
  });
});

describe("fmerp_backup 역할", () => {
  it("모든 계정의 데이터를 읽지만(RLS 우회) 업무 데이터는 쓰지 못한다", async () => {
    const accounts = await backup.pool.query("select id from account");
    expect(accounts.rowCount).toBeGreaterThanOrEqual(2);
    const perAccount = await backup.pool.query(
      "select count(distinct account_id)::int as n from membership",
    );
    expect(perAccount.rows[0].n).toBeGreaterThanOrEqual(2);
    // 같은 조회를 계정 컨텍스트 없는 앱 역할이 하면 RLS로 아무것도 보이지 않는다
    expect((await app.pool.query("select 1 from membership")).rowCount).toBe(0);
    await expect(backup.pool.query("update account set name = name")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      backup.pool.query("insert into audit_log (action, result) values ('x', 'success')"),
    ).rejects.toThrow(/permission denied/);
    await expect(backup.pool.query("delete from document")).rejects.toThrow(/permission denied/);
    await expect(backup.pool.query("create table t_backup (id int)")).rejects.toThrow(
      /permission denied/,
    );
  });
});

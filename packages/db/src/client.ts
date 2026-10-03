import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle({ client: pool, schema, casing: "snake_case" });
  return { pool, db };
}

export type Database = ReturnType<typeof createDatabase>;
export type Db = Database["db"];
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** 쓰기·조회에 쓰는 DB 또는 트랜잭션 */
export type Executor = Db | Tx;

export async function pingDatabase(pool: pg.Pool): Promise<void> {
  await pool.query("select 1");
}

/**
 * 테넌트를 지정한 트랜잭션 안에서 실행한다. 앱 계정(fmerp_app)의 RLS 정책이 이 값으로 행을 거른다 (PRD PERM-002).
 * 테넌트 데이터는 반드시 이 함수 안에서 조회·변경한다.
 */
export function withTenant<T>(db: Db, accountId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.account_id', ${accountId}, true)`);
    return fn(tx);
  });
}

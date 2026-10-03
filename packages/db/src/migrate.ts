import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

// 앱 번들(Next)이 migrations 폴더를 끌어가지 않도록 패키지 진입점(index.ts)에서 내보내지 않는다.
// 사용: import { runMigrations } from "@fmerp/db/migrate"

/** 마이그레이션 계정(MIGRATION_DATABASE_URL)으로 실행한다. 앱 계정은 public 스키마 DDL 권한이 없다. */
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

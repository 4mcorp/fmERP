import pg from "pg";
import { runMigrations } from "../src/migrate";

/**
 * 테스트 전용 DB(docker-compose.dev.yml의 postgres-test, 포트 55433)를 최신 스키마로 맞추고 public 테이블을 모두 비운다.
 * Vitest 통합 테스트와 Playwright E2E가 함께 쓴다. 다른 DB는 실수로라도 초기화하지 않는다.
 */
export async function resetTestDatabase(migrationUrl: string): Promise<void> {
  if (!/localhost:55433\//.test(migrationUrl)) {
    throw new Error("테스트 DB(포트 55433)가 아닌 곳은 초기화하지 않습니다");
  }
  await runMigrations(migrationUrl);

  const client = new pg.Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    if (rows.length > 0) {
      const tables = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
      await client.query(`truncate ${tables} cascade`);
    }
  } finally {
    await client.end();
  }
}

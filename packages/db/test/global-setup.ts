import { runMigrations } from "../src/migrate";

/** 통합 테스트 전에 테스트 전용 DB(docker-compose.dev.yml의 postgres-test)를 최신 스키마로 맞춘다. */
export default async function setup() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url)
    throw new Error("MIGRATION_DATABASE_URL이 없습니다 (vitest.config.ts 통합 테스트 env 확인)");
  await runMigrations(url);
}

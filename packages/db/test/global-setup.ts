import type { TestProject } from "vitest/node";
import { runMigrations } from "../src/migrate";

/** 통합 테스트 전에 테스트 전용 DB(docker-compose.dev.yml의 postgres-test)를 최신 스키마로 맞춘다. */
export default async function setup(project: TestProject) {
  // test.env는 테스트 워커에만 주입되므로 globalSetup에서는 프로젝트 설정에서 직접 읽는다
  const url = project.config.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL이 없습니다 (vitest.config.ts 통합 테스트 env)");
  await runMigrations(url);
}

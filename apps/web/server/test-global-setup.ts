import { createDatabase } from "@fmerp/db";
import { seedTestAccounts } from "@fmerp/feature-account/seed";
import { seedTestOrganization } from "@fmerp/feature-account/seed-org";
import { installDefaultForms } from "@fmerp/feature-approval/provisioning";
import type { TestProject } from "vitest/node";

/** 통합 테스트용 시드 계정을 넣는다 (db의 global-setup이 테이블을 비운 뒤 실행된다). */
export default async function setup(project: TestProject) {
  const url = project.config.env.AUTH_DATABASE_URL;
  if (!url) throw new Error("AUTH_DATABASE_URL이 없습니다 (vitest.config.ts 통합 테스트 env)");
  const migrationUrl = project.config.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl)
    throw new Error("MIGRATION_DATABASE_URL이 없습니다 (vitest.config.ts 통합 테스트 env)");
  const { db, pool } = createDatabase(url);
  const migrator = createDatabase(migrationUrl);
  try {
    await seedTestAccounts(db);
    await seedTestOrganization(migrator.db, installDefaultForms);
  } finally {
    await pool.end();
    await migrator.pool.end();
  }
}

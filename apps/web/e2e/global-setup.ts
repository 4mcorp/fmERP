import { seedTestAccounts } from "@fmerp/auth/seed";
import { seedTestOrganization } from "@fmerp/auth/seed-org";
import { createDatabase } from "@fmerp/db";
import { resetTestDatabase } from "@fmerp/db/test/reset";
import { e2eEnv } from "./test-env";

/** E2E 전에 테스트 DB를 비우고 시드 계정을 넣는다 (실행마다 같은 상태에서 시작) */
export default async function globalSetup() {
  await resetTestDatabase(e2eEnv.MIGRATION_DATABASE_URL);
  const { db, pool } = createDatabase(e2eEnv.AUTH_DATABASE_URL);
  const migrator = createDatabase(e2eEnv.MIGRATION_DATABASE_URL);
  try {
    await seedTestAccounts(db);
    await seedTestOrganization(migrator.db);
  } finally {
    await pool.end();
    await migrator.pool.end();
  }
}

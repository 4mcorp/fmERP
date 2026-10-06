import { createDatabase } from "@fmerp/db";
import { installDefaultForms } from "@fmerp/feature-approval/provisioning";
import { seedTestAccounts } from "./seed/seed";
import { seedTestOrganization } from "./seed/seed-org";

if (process.env.NODE_ENV === "production") {
  console.error("운영 환경에서는 테스트 계정 시드를 실행할 수 없습니다.");
  process.exit(1);
}
const url = process.env.AUTH_DATABASE_URL;
if (!url) {
  console.error("AUTH_DATABASE_URL이 설정되지 않았습니다 (.env.example 참고).");
  process.exit(1);
}

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!migrationUrl) {
  console.error("MIGRATION_DATABASE_URL이 설정되지 않았습니다 (조직 시드에 필요).");
  process.exit(1);
}

const { db, pool } = createDatabase(url);
const migrator = createDatabase(migrationUrl);
try {
  const result = await seedTestAccounts(db);
  await seedTestOrganization(migrator.db, installDefaultForms);
  console.log(`테스트 계정 시드 완료: 사용자 ${result.users}명, 회사 ${result.accounts}개`);
} finally {
  await pool.end();
  await migrator.pool.end();
}

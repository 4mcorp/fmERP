import { createDatabase } from "@fmerp/db";
import { seedTestAccounts } from "./seed";

if (process.env.NODE_ENV === "production") {
  console.error("운영 환경에서는 테스트 계정 시드를 실행할 수 없습니다.");
  process.exit(1);
}
const url = process.env.AUTH_DATABASE_URL;
if (!url) {
  console.error("AUTH_DATABASE_URL이 설정되지 않았습니다 (.env.example 참고).");
  process.exit(1);
}

const { db, pool } = createDatabase(url);
try {
  const result = await seedTestAccounts(db);
  console.log(`테스트 계정 시드 완료: 사용자 ${result.users}명, 회사 ${result.accounts}개`);
} finally {
  await pool.end();
}

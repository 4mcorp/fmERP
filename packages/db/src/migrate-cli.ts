import { runMigrations } from "./migrate";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error("MIGRATION_DATABASE_URL이 설정되지 않았습니다 (.env.example 참고).");
  process.exit(1);
}

await runMigrations(url);
console.log("마이그레이션 완료");

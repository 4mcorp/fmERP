import { createDatabase } from "@fmerp/db";
import type { TestProject } from "vitest/node";
import { seedTestAccounts } from "../src/seed";

/** 통합 테스트용 시드 계정을 넣는다 (db의 global-setup이 테이블을 비운 뒤 실행된다). */
export default async function setup(project: TestProject) {
  const url = project.config.env.AUTH_DATABASE_URL;
  if (!url) throw new Error("AUTH_DATABASE_URL이 없습니다 (vitest.config.ts 통합 테스트 env)");
  const { db, pool } = createDatabase(url);
  try {
    await seedTestAccounts(db);
  } finally {
    await pool.end();
  }
}

import { defineConfig } from "vitest/config";

// 통합 테스트 대상: docker-compose.dev.yml의 postgres-test(55433)·s3(58333). CI도 같은 Compose를 쓴다 (ADR 0004)
// 아래 값은 로컬 테스트 컨테이너 전용이며 비밀정보가 아니다.
// 대상은 환경변수로 바꿀 수 있다(미지정 시 기본값): TEST_DB_PORT(55433), TEST_DB_NAME(fmerp), TEST_S3_ENDPOINT(http://localhost:58333).
// 잘못된 DB 대상은 globalSetup의 resetTestDatabase 허용목록 가드가 거부한다.
const db = {
  port: process.env.TEST_DB_PORT || "55433",
  name: process.env.TEST_DB_NAME || "fmerp",
};
const s3Endpoint = process.env.TEST_S3_ENDPOINT || "http://localhost:58333";

export const integrationEnv = {
  DATABASE_URL: `postgres://fmerp_app:fmerp_app_dev@localhost:${db.port}/${db.name}`,
  AUTH_DATABASE_URL: `postgres://fmerp_auth:fmerp_auth_dev@localhost:${db.port}/${db.name}`,
  MIGRATION_DATABASE_URL: `postgres://fmerp_migrator:fmerp_migrator_dev@localhost:${db.port}/${db.name}`,
  BACKUP_DATABASE_URL: `postgres://fmerp_backup:fmerp_backup_dev@localhost:${db.port}/${db.name}`,
  BETTER_AUTH_SECRET: "integration-test-secret-not-for-production-use",
  BETTER_AUTH_URL: "http://localhost:3000",
  DEV_TEST_LOGIN: "true",
  // 시스템 관리자(DB 덤프 권한) 테스트 계정
  SYSTEM_ADMIN_EMAILS: "owner@example.com",
  S3_ENDPOINT: s3Endpoint,
  S3_REGION: "us-east-1",
  S3_BUCKET: "fmerp-test",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test",
  S3_FORCE_PATH_STYLE: "true",
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: [
            "{apps,packages}/*/{src,server}/**/*.test.ts",
            "shared/src/**/*.test.ts",
            "features/*/{src,tests}/**/*.test.ts",
            "tools/src/**/*.test.ts",
          ],
          exclude: ["**/*.int.test.ts", "**/node_modules/**"],
        },
      },
      {
        test: {
          name: "integration",
          include: [
            "{apps,packages}/*/{src,server}/**/*.int.test.ts",
            "shared/src/**/*.int.test.ts",
            "features/*/{src,tests}/**/*.int.test.ts",
          ],
          env: integrationEnv,
          setupFiles: ["apps/web/server/test-support.ts"],
          // 순서 중요: DB 초기화·마이그레이션 → 테스트 버킷 → 시드 계정
          globalSetup: [
            "packages/db/test/global-setup.ts",
            "packages/storage/test/global-setup.ts",
            "apps/web/server/test-global-setup.ts",
          ],
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});

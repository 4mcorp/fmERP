import { defineConfig } from "vitest/config";

// 통합 테스트 대상: docker-compose.dev.yml의 postgres-test(55433)·s3(58333). CI도 같은 Compose를 쓴다 (ADR 0004)
// 아래 값은 로컬 테스트 컨테이너 전용이며 비밀정보가 아니다.
const integrationEnv = {
  DATABASE_URL: "postgres://fmerp_app:fmerp_app_dev@localhost:55433/fmerp",
  AUTH_DATABASE_URL: "postgres://fmerp_auth:fmerp_auth_dev@localhost:55433/fmerp",
  MIGRATION_DATABASE_URL: "postgres://fmerp_migrator:fmerp_migrator_dev@localhost:55433/fmerp",
  BACKUP_DATABASE_URL: "postgres://fmerp_backup:fmerp_backup_dev@localhost:55433/fmerp",
  BETTER_AUTH_SECRET: "integration-test-secret-not-for-production-use",
  BETTER_AUTH_URL: "http://localhost:3000",
  DEV_TEST_LOGIN: "true",
  S3_ENDPOINT: "http://localhost:58333",
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
          include: ["{apps,packages}/*/{src,server}/**/*.test.ts"],
          exclude: ["**/*.int.test.ts", "**/node_modules/**"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["{apps,packages}/*/{src,server}/**/*.int.test.ts"],
          env: integrationEnv,
          // 순서 중요: DB 초기화·마이그레이션 → 테스트 버킷 → 시드 계정
          globalSetup: [
            "packages/db/test/global-setup.ts",
            "packages/storage/test/global-setup.ts",
            "packages/auth/test/global-setup.ts",
          ],
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});

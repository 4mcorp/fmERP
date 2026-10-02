import { defineConfig } from "vitest/config";

// 통합 테스트 대상: docker-compose.dev.yml의 postgres-test(55433)·s3(58333). CI도 같은 Compose를 쓴다 (ADR 0004)
const integrationEnv = {
  DATABASE_URL: "postgres://fmerp_app:fmerp_app_dev@localhost:55433/fmerp",
  MIGRATION_DATABASE_URL: "postgres://fmerp_migrator:fmerp_migrator_dev@localhost:55433/fmerp",
  S3_ENDPOINT: "http://localhost:58333",
  S3_REGION: "us-east-1",
  S3_BUCKET: "fmerp-test",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test",
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
          globalSetup: [
            "packages/db/test/global-setup.ts",
            "packages/storage/test/global-setup.ts",
          ],
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});

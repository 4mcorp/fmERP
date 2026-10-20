import { readTestDbTarget } from "@fmerp/db/test/reset";

// E2E 전용 환경: 개발 DB를 건드리지 않도록 테스트 DB와 테스트 버킷을 쓴다.
// 대상은 환경변수로 바꿀 수 있다(미지정 시 기본값): TEST_DB_PORT(55433), TEST_DB_NAME(fmerp),
// TEST_E2E_PORT(3100), TEST_S3_ENDPOINT(http://localhost:58333). 로컬 테스트 컨테이너 전용 값이며 비밀정보가 아니다.
const db = readTestDbTarget();
const e2ePort = Number(process.env.TEST_E2E_PORT || 3100);
if (!Number.isInteger(e2ePort) || e2ePort < 1 || e2ePort > 65535) {
  throw new Error(`E2E 포트가 올바르지 않습니다: ${process.env.TEST_E2E_PORT}`);
}
const s3Endpoint = process.env.TEST_S3_ENDPOINT || "http://localhost:58333";

export const E2E_PORT = e2ePort;

export const e2eEnv = {
  DATABASE_URL: `postgres://fmerp_app:fmerp_app_dev@localhost:${db.port}/${db.name}`,
  AUTH_DATABASE_URL: `postgres://fmerp_auth:fmerp_auth_dev@localhost:${db.port}/${db.name}`,
  MIGRATION_DATABASE_URL: `postgres://fmerp_migrator:fmerp_migrator_dev@localhost:${db.port}/${db.name}`,
  BETTER_AUTH_SECRET: "e2e-test-secret-not-for-production-use-0000",
  BETTER_AUTH_URL: `http://localhost:${E2E_PORT}`,
  DEV_TEST_LOGIN: "true",
  SYSTEM_ADMIN_EMAILS: "owner@example.com",
  S3_ENDPOINT: s3Endpoint,
  S3_REGION: "us-east-1",
  S3_BUCKET: "fmerp-test",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test",
  S3_FORCE_PATH_STYLE: "true",
};

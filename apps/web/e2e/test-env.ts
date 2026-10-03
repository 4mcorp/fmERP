// E2E 전용 환경: 개발 DB를 건드리지 않도록 테스트 DB(55433)와 테스트 버킷을 쓴다.
// 로컬 테스트 컨테이너 전용 값이며 비밀정보가 아니다.
export const E2E_PORT = 3100;

export const e2eEnv = {
  DATABASE_URL: "postgres://fmerp_app:fmerp_app_dev@localhost:55433/fmerp",
  AUTH_DATABASE_URL: "postgres://fmerp_auth:fmerp_auth_dev@localhost:55433/fmerp",
  MIGRATION_DATABASE_URL: "postgres://fmerp_migrator:fmerp_migrator_dev@localhost:55433/fmerp",
  BETTER_AUTH_SECRET: "e2e-test-secret-not-for-production-use-0000",
  BETTER_AUTH_URL: `http://localhost:${E2E_PORT}`,
  DEV_TEST_LOGIN: "true",
  S3_ENDPOINT: "http://localhost:58333",
  S3_REGION: "us-east-1",
  S3_BUCKET: "fmerp-test",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test",
  S3_FORCE_PATH_STYLE: "true",
};

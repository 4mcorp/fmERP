import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** 앱 업무 데이터 (fmerp_app, RLS 적용) */
  DATABASE_URL: z.url(),
  /** Better Auth 전용 (fmerp_auth, RLS 우회 — ADR 0005) */
  AUTH_DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  DEV_TEST_LOGIN: z.string().optional(),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

/** 빌드 시점이 아니라 첫 요청 시점에 검증한다 (next build에는 운영 환경 변수가 없음). */
export function getEnv(): ServerEnv {
  cached ??= schema.parse(process.env);
  return cached;
}

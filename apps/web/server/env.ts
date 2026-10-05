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
  /** 스테이징만 "staging". 운영 모드에서 테스트 로그인을 켜는 유일한 예외 (resolveDevTestLogin) */
  APP_ENV: z.string().optional(),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  /** DB 덤프를 다룰 수 있는 시스템 관리자의 이메일(쉼표 구분). 비어 있으면 덤프 기능 전체가 꺼진다 (M7) */
  SYSTEM_ADMIN_EMAILS: z.string().optional(),
  /** 텔레그램 알림 (M8). 토큰은 비밀정보라 .env에만 둔다. 없으면 텔레그램 기능이 꺼진다 */
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  /** 연결 링크(t.me/<봇 이름>?start=…)에 쓰는 봇 사용자 이름 (@ 없이) */
  TELEGRAM_BOT_USERNAME: z
    .string()
    .regex(/^[A-Za-z0-9_]{3,64}$/)
    .optional(),
  /** Bot API 주소 (시험용 가짜 서버로 바꿀 때만) */
  TELEGRAM_API_BASE_URL: z.url().optional(),
  /** 웹훅 요청 검증용 비밀 값. worker와 같은 값 */
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

/** 빌드 시점이 아니라 첫 요청 시점에 검증한다 (next build에는 운영 환경 변수가 없음). */
export function getEnv(): ServerEnv {
  cached ??= schema.parse(process.env);
  return cached;
}

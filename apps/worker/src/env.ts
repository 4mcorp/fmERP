import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url(),
  /** 서명·도장 이미지 키를 읽는 인증 DB 연결 (앱 DB 역할은 그 컬럼을 읽을 수 없다) */
  AUTH_DATABASE_URL: z.url(),
  WORKER_PORT: z.coerce.number().int().positive().default(3001),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** PDF용 글꼴(Pretendard woff2) 폴더. 없으면 시스템 글꼴로 대체한다 */
  FONT_DIR: z.string().default("fonts"),
  /** 백업 전용 DB 연결 (RLS 우회·읽기 전용 + 덤프 이력 갱신, M7). 없으면 백업이 꺼진다 (운영에서는 필수) */
  BACKUP_DATABASE_URL: z.url().optional(),
  /** age 공개키(`age1…`), 쉼표 구분. 개인키는 서버에 두지 않는다 */
  BACKUP_AGE_RECIPIENTS: z.string().optional(),
  /** pg_dump 실행 명령. 개발 PC에서는 DB 컨테이너 안에서 실행하도록 바꿀 수 있다 */
  PG_DUMP_COMMAND: z.string().default("pg_dump"),
  /** pg_restore 실행 명령 (복원·복구 리허설 CLI) */
  PG_RESTORE_COMMAND: z.string().default("pg_restore"),
  /** 복구 리허설이 임시 DB를 만들고 지울 수 있는 관리 연결 (CREATEDB 권한) */
  REHEARSAL_ADMIN_URL: z.url().optional(),
  /** pg_restore가 접속할 서버 주소 (기본은 REHEARSAL_ADMIN_URL). 컨테이너 안에서 실행하면 그 안에서 보이는 주소 */
  REHEARSAL_TOOL_URL: z.url().optional(),
  /** pg_dump가 접속할 URL (기본은 BACKUP_DATABASE_URL). 컨테이너 안에서 실행하면 그 안에서 보이는 주소 */
  BACKUP_PG_DUMP_URL: z.url().optional(),
  /** 텔레그램 봇 토큰(@BotFather). 없으면 텔레그램 알림이 꺼진다. 비밀정보라 .env에만 둔다 */
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  /** Bot API 주소 (시험용 가짜 서버로 바꿀 때만 쓴다) */
  TELEGRAM_API_BASE_URL: z.url().optional(),
  /** 웹훅 요청 검증용 비밀 값 (웹 서버와 같은 값). 웹훅을 쓸 때만 필요 */
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
  /** 웹 푸시(VAPID) 공개 키. 세 값이 모두 있을 때만 푸시가 켜진다. 빈 문자열은 없는 값 */
  VAPID_PUBLIC_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional()),
  /** 웹 푸시(VAPID) 개인 키. 비밀정보라 .env에만 둔다 */
  VAPID_PRIVATE_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional()),
  /** 웹 푸시 연락처 (mailto: 또는 https:) */
  VAPID_SUBJECT: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^(mailto:|https:)/)
      .optional(),
  ),
  /** 사용자가 접속하는 공개 주소. 알림 링크와 웹훅 등록 주소의 기준 (웹훅은 https만) */
  PUBLIC_BASE_URL: z.url().default("http://localhost:3000"),
  /** 덤프 문제 알림을 받을 시스템 관리자 이메일(쉼표 구분). 웹 서버와 같은 값 */
  SYSTEM_ADMIN_EMAILS: z.string().optional(),
  NODE_ENV: z.string().optional(),
});

export const env = schema.parse(process.env);

/** 운영에서는 백업 설정이 빠지면 조용히 백업 없이 도는 일이 없도록 기동을 막는다 */
if (env.NODE_ENV === "production" && (!env.BACKUP_DATABASE_URL || !env.BACKUP_AGE_RECIPIENTS)) {
  throw new Error("운영에서는 BACKUP_DATABASE_URL과 BACKUP_AGE_RECIPIENTS가 필요합니다");
}

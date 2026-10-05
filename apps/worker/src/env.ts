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
  NODE_ENV: z.string().optional(),
});

export const env = schema.parse(process.env);

/** 운영에서는 백업 설정이 빠지면 조용히 백업 없이 도는 일이 없도록 기동을 막는다 */
if (env.NODE_ENV === "production" && (!env.BACKUP_DATABASE_URL || !env.BACKUP_AGE_RECIPIENTS)) {
  throw new Error("운영에서는 BACKUP_DATABASE_URL과 BACKUP_AGE_RECIPIENTS가 필요합니다");
}

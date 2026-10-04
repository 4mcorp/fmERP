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
});

export const env = schema.parse(process.env);

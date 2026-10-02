import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url(),
});

let cached: z.infer<typeof schema> | undefined;

/** 빌드 시점이 아니라 첫 요청 시점에 검증한다 (next build에는 운영 환경 변수가 없음). */
export function getEnv() {
  cached ??= schema.parse(process.env);
  return cached;
}

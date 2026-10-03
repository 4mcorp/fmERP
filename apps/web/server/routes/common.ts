import { z } from "@hono/zod-openapi";
import { ProblemSchema } from "../problem";

const problemContent = { "application/problem+json": { schema: ProblemSchema } };

/** OpenAPI 문서에 공통 오류 응답을 표시한다. 실제 응답은 onError가 만든다 (http.ts) */
export const errorResponses = {
  400: { description: "입력 오류", content: problemContent },
  401: { description: "로그인 필요·세션 만료", content: problemContent },
  403: { description: "권한 없음", content: problemContent },
} as const;

export const OkSchema = z.object({ ok: z.literal(true) }).openapi("Ok");

export const json = <T extends z.ZodType>(schema: T, description = "성공") => ({
  description,
  content: { "application/json": { schema } },
});

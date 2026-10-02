import { z } from "@hono/zod-openapi";

/** API 에러 응답 형식: RFC 9457 Problem Details + 업무 오류 코드 (ADR 0003). */
export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.string(),
    detail: z.string().optional(),
  })
  .openapi("Problem");

export type Problem = z.infer<typeof ProblemSchema>;

export const PROBLEM_HEADERS = { "Content-Type": "application/problem+json" } as const;

export function problemBody(status: number, code: string, title: string, detail?: string): Problem {
  return { type: `urn:fmerp:problem:${code}`, title, status, code, detail };
}

/** OpenAPI 라우트 밖(notFound, onError)에서 쓰는 응답. 라우트 안에서는 c.json(problemBody(...))를 쓴다. */
export function problem(status: number, code: string, title: string, detail?: string): Response {
  return new Response(JSON.stringify(problemBody(status, code, title, detail)), {
    status,
    headers: PROBLEM_HEADERS,
  });
}

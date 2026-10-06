import {
  type AppEnv,
  type AppRouter,
  requestContext,
  toProblemResponse,
} from "@fmerp/shared/server/http";
import { PROBLEM_HEADERS, ProblemSchema, problem, problemBody } from "@fmerp/shared/server/problem";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

export interface AppOptions {
  /** DB 연결 확인. 실패하면 예외를 던진다. */
  pingDatabase: () => Promise<void>;
  /** 업무 라우트 등록 (app.ts). 단위 테스트에서는 생략한다 */
  register?: (app: AppRouter) => void;
}

const HealthSchema = z.object({ status: z.literal("ok"), db: z.literal("ok") }).openapi("Health");

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["system"],
  summary: "서비스·DB 상태 확인",
  responses: {
    200: { description: "정상", content: { "application/json": { schema: HealthSchema } } },
    503: {
      description: "DB 연결 실패",
      content: { "application/problem+json": { schema: ProblemSchema } },
    },
  },
});

export function createApp(options: AppOptions) {
  const app = new OpenAPIHono<AppEnv>({
    // 입력 검증 실패도 RFC 9457 형식으로 응답한다 (ADR 0003)
    defaultHook: (result) => {
      if (!result.success) {
        const detail = result.error.issues
          .map((i) => `${i.path.join(".") || "(본문)"}: ${i.message}`)
          .join("; ");
        return problem(400, "validation_error", "입력값이 올바르지 않습니다", detail);
      }
    },
  }).basePath("/api");

  app.use("*", requestContext);

  app.openapi(healthRoute, async (c) => {
    try {
      await options.pingDatabase();
    } catch (error) {
      // 원인은 서버 로그에만 남기고 응답에는 노출하지 않는다 (ADR 0003)
      console.error("[api] DB 연결 확인 실패", error);
      return c.json(
        problemBody(503, "db_unavailable", "DB에 연결할 수 없습니다"),
        503,
        PROBLEM_HEADERS,
      );
    }
    return c.json({ status: "ok" as const, db: "ok" as const }, 200);
  });

  options.register?.(app);

  app.doc31("/doc", {
    openapi: "3.1.0",
    info: { title: "4mERP API", version: "0.0.0" },
  });

  app.notFound(() => problem(404, "not_found", "요청한 경로가 없습니다"));
  app.onError((error) => {
    const handled = toProblemResponse(error);
    if (handled) return handled;
    console.error("[api] 처리되지 않은 오류", error);
    return problem(500, "internal_error", "서버 오류가 발생했습니다");
  });

  return app;
}

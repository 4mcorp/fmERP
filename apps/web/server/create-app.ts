import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { PROBLEM_HEADERS, ProblemSchema, problem, problemBody } from "./problem";

export interface AppDeps {
  /** DB 연결 확인. 실패하면 예외를 던진다. */
  pingDatabase: () => Promise<void>;
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

export function createApp(deps: AppDeps) {
  const app = new OpenAPIHono().basePath("/api");

  app.openapi(healthRoute, async (c) => {
    try {
      await deps.pingDatabase();
    } catch {
      return c.json(
        problemBody(503, "db_unavailable", "DB에 연결할 수 없습니다"),
        503,
        PROBLEM_HEADERS,
      );
    }
    return c.json({ status: "ok" as const, db: "ok" as const }, 200);
  });

  app.doc31("/doc", {
    openapi: "3.1.0",
    info: { title: "4mERP API", version: "0.0.0" },
  });

  app.notFound(() => problem(404, "not_found", "요청한 경로가 없습니다"));
  app.onError((error) => {
    console.error("[api] 처리되지 않은 오류", error);
    return problem(500, "internal_error", "서버 오류가 발생했습니다");
  });

  return app;
}

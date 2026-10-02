import { Hono } from "hono";

/** worker는 HTTP API를 제공하지 않는다. 헬스체크만 연다 (docs/rules/architecture.md 2장). */
export function createHealthApp(isReady: () => boolean) {
  return new Hono().get("/health", (c) =>
    isReady() ? c.json({ status: "ok" }) : c.json({ status: "starting" }, 503),
  );
}

import { describe, expect, it } from "vitest";
import { createApp } from "./create-app";

const ok = createApp({ pingDatabase: async () => {} });
const dbDown = createApp({
  pingDatabase: async () => {
    throw new Error("connection refused");
  },
});

describe("API 골격", () => {
  it("DB가 정상이면 /api/health는 200", async () => {
    const res = await ok.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok" });
  });

  it("DB 연결 실패는 503 Problem Details로 응답하고 내부 오류 내용을 노출하지 않는다", async () => {
    const res = await dbDown.request("/api/health");
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const body = await res.json();
    expect(body).toMatchObject({ status: 503, code: "db_unavailable" });
    expect(JSON.stringify(body)).not.toContain("connection refused");
  });

  it("없는 경로는 404 Problem Details", async () => {
    const res = await ok.request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_found" });
  });

  it("/api/doc에 OpenAPI 3.1 문서가 있다", async () => {
    const res = await ok.request("/api/doc");
    const doc = await res.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toContain("/api/health");
  });
});

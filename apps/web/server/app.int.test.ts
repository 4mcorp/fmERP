import { describe, expect, it } from "vitest";
import { app } from "./app";

describe("/api/health (실제 테스트 DB)", () => {
  it("DB에 연결되어 200을 반환한다", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok" });
  });
});

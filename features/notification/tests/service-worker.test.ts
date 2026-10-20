// 서비스 워커 제공 응답 단위 테스트: 헤더(MIME·범위·캐시)와 본문(push·알림 클릭, 캐시 대상 한정)을 확인한다
import { describe, expect, it } from "vitest";
import { serviceWorkerResponse } from "../src/sw/service-worker";

describe("서비스 워커 응답 (/sw.js)", () => {
  it("JavaScript MIME·앱 전체 범위·캐시 금지 헤더로 응답한다", () => {
    const res = serviceWorkerResponse();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("Service-Worker-Allowed")).toBe("/");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("push 표시와 알림 클릭 처리를 담는다", async () => {
    const body = await serviceWorkerResponse().text();
    expect(body).toContain('addEventListener("push"');
    expect(body).toContain('addEventListener("notificationclick"');
  });

  it("캐시 대상은 정적 자산 경로로 한정되고 API·인증 경로는 들어가지 않는다", async () => {
    const body = await serviceWorkerResponse().text();
    expect(body).toContain("/_next/static/");
    expect(body).not.toMatch(/\/api\//);
  });
});

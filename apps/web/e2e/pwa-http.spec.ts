import { expect, test } from "@playwright/test";

// PWA HTTP 확인: 헬스 체크, 매니페스트, 서비스 워커 응답 헤더, 아이콘 응답을 요청 fixture로 확인한다.
// 기능 동작(push·알림 클릭)과 manifest 필드는 pwa.spec.ts가 본다.

test.describe("PWA HTTP 응답 (health·manifest·sw.js·아이콘)", () => {
  test("/api/health가 200을 준다", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
  });

  test("/manifest.webmanifest가 JSON 매니페스트로 응답한다", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("manifest+json");
    const manifest = await res.json();
    expect(manifest.display).toBe("standalone");
  });

  test("/sw.js는 앱 전체 범위와 캐시 금지 헤더로 응답한다", async ({ request }) => {
    const res = await request.get("/sw.js");
    expect(res.status()).toBe(200);
    expect(res.headers()["service-worker-allowed"]).toBe("/");
    expect(res.headers()["cache-control"]).toBe("no-cache");
    expect(res.headers()["content-type"]).toContain("javascript");
  });

  test("manifest 아이콘 192·512·maskable-512가 PNG로 응답한다", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    const manifest = await res.json();
    const wanted = ["192x192:any", "512x512:any", "512x512:maskable"];
    const icons = manifest.icons as { src: string; sizes: string; purpose?: string }[];
    for (const key of wanted) {
      const [sizes, purpose] = key.split(":");
      const icon = icons.find((i) => i.sizes === sizes && (i.purpose ?? "any") === purpose);
      expect(icon, `${key} 아이콘이 매니페스트에 있어야 한다`).toBeDefined();
      const img = await request.get(icon?.src ?? "");
      expect(img.status(), icon?.src).toBe(200);
      expect(img.headers()["content-type"]).toContain("image/png");
    }
  });
});

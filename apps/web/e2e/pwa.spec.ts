import { expect, test } from "@playwright/test";

// PWA 홈 화면 설치 검증: manifest 필드, iOS 메타, 아이콘 파일, 서비스 워커 제공.
// 실기기(iOS Safari·삼성 인터넷)의 홈 화면 설치와 push 수신은 여기서 확인하지 않는다 (docs/ops/prod.md 수동 절차).

test.describe("PWA 홈 화면 설치 (manifest·아이콘·서비스 워커)", () => {
  test("manifest가 standalone 설치 필드를 갖는다", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBe(true);
    const manifest = await res.json();
    expect(manifest.name).toBe("4mERP");
    expect(manifest.short_name).toBe("4mERP");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    const sizes = (manifest.icons as { sizes: string; purpose?: string; src: string }[]).map(
      (i) => `${i.sizes}:${i.purpose ?? "any"}`,
    );
    expect(sizes).toEqual(
      expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]),
    );
  });

  test("manifest가 가리키는 아이콘이 저장소 안 파일로 실제로 응답한다", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    const manifest = await res.json();
    for (const icon of manifest.icons as { src: string }[]) {
      expect(icon.src.startsWith("/")).toBe(true); // 외부 주소가 아니다
      const img = await request.get(icon.src);
      expect(img.ok(), icon.src).toBe(true);
      expect(img.headers()["content-type"]).toContain("image/png");
    }
    const apple = await request.get("/icons/apple-touch-icon.png");
    expect(apple.ok()).toBe(true);
  });

  test("페이지에 iOS 홈 화면 메타와 apple-touch-icon이 렌더된다", async ({ page }) => {
    await page.goto("/dev-login");
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
      "content",
      "yes",
    );
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      "/icons/apple-touch-icon.png",
    );
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );
  });

  test("서비스 워커 스크립트를 제공한다 (push·알림 클릭 처리 포함)", async ({ request }) => {
    const res = await request.get("/sw.js");
    expect(res.ok()).toBe(true);
    const body = await res.text();
    expect(body).toContain('addEventListener("push"');
    expect(body).toContain('addEventListener("notificationclick"');
    // API·인증 응답은 캐시하지 않는다: 캐시 대상은 정적 자산 경로로 한정된다
    expect(body).toContain("/_next/static/");
    expect(body).not.toMatch(/\/api\//);
  });
});

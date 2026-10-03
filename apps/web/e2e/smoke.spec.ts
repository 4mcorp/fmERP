import { expect, test } from "@playwright/test";

test("로그인하지 않으면 테스트 로그인 화면으로 이동한다", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/dev-login/);
  await expect(page.getByRole("heading", { level: 1, name: "4mERP 테스트 로그인" })).toBeVisible();
});

test("API 헬스체크가 DB 연결을 확인한다", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok", db: "ok" });
});

import { expect, type Page, test } from "@playwright/test";

async function loginAs(page: Page, name: string) {
  // 시드 계정은 PIN이 없어 로그인 직후 PIN 설정 안내 모달이 뜨고 이후 클릭을 가로챈다 — 안내는 닫은 상태로 시작한다
  await page.addInitScript(() => window.sessionStorage.setItem("pin-setup-remind-dismissed", "1"));
  await page.goto("/dev-login");
  await page.getByRole("button", { name: `${name}(으)로 로그인` }).click();
  await expect(page).not.toHaveURL(/\/dev-login/);
}

test("홈 응답이 늦으면 로딩 상태를 보여 준다", async ({ page }) => {
  await loginAs(page, "박사원");
  // 계정 정보 응답을 끝내지 않고 붙잡아 둔다 — 홈은 로딩 상태에 머문다
  await page.route("**/api/account", () => new Promise<void>(() => {}));
  await page.goto("/");
  await expect(page.locator('[data-slot="loading-state"]').first()).toBeVisible();
  await expect(page.getByText("불러오는 중…").first()).toBeVisible();
});

test("홈 데이터 요청이 실패하면 오류 상태와 다시 시도 버튼을 보여 준다", async ({ page }) => {
  await loginAs(page, "박사원");
  await page.route("**/api/account", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify({ code: "internal", title: "서버 오류" }),
    }),
  );
  await page.goto("/");
  const error = page.locator('[data-slot="query-error-state"]');
  await expect(error).toBeVisible();
  await expect(error).toContainText("다시 시도");
  await expect(error.getByRole("button", { name: "다시 시도" })).toBeVisible();
});

test("없는 문서 주소로 들어가면 한국어 404 화면을 보여 준다", async ({ page }) => {
  await loginAs(page, "박사원");
  await page.goto("/no-such-page-for-e2e");
  await expect(
    page.getByRole("heading", { level: 1, name: "페이지를 찾을 수 없습니다" }),
  ).toBeVisible();
  await expect(page.getByText("404", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "홈으로 이동" })).toBeVisible();
});

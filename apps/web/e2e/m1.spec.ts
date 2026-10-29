import { expect, type Page, test } from "@playwright/test";

async function loginAs(page: Page, name: string) {
  // 시드 계정은 PIN이 없어 로그인 직후 PIN 설정 안내 모달이 뜨고 이후 클릭을 가로챈다 — 안내는 닫은 상태로 시작한다
  await page.addInitScript(() => window.sessionStorage.setItem("pin-setup-remind-dismissed", "1"));
  await page.goto("/dev-login");
  await page.getByRole("button", { name: `${name}(으)로 로그인` }).click();
  await expect(page).not.toHaveURL(/\/dev-login/);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "사용자 메뉴" }).click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login/);
}

test("테스트 계정으로 로그인하면 소속 회사 홈이 열린다", async ({ page }) => {
  await loginAs(page, "박사원");
  await expect(page.getByRole("heading", { level: 1, name: "포엠테스트(주)" })).toBeVisible();
  await expect(page.getByText("박사원님 · 구성원")).toBeVisible();
});

test("360px 화면에서도 가로 스크롤 없이 홈이 보인다", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "모바일 전용");
  await loginAs(page, "박사원");
  await expect(page.getByRole("heading", { level: 1, name: "포엠테스트(주)" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

// 아래는 DB 상태를 바꾸므로 @stateful 태그를 달아 데스크톱 프로젝트에서만 한 번 실행한다 (playwright.config.ts)
test.describe("관리자 초대 → 신규 사용자 합류 → 계정 전환·PIN (S1 대체 흐름)", {
  tag: "@stateful",
}, () => {
  test("초대 링크로 합류하고, 두 회사 소속자는 회사를 전환한다", async ({ page }) => {
    // 1) 관리자가 초대 링크를 만든다
    await loginAs(page, "이관리");
    await page.getByRole("button", { name: "사용자 메뉴" }).click();
    await page.getByRole("menuitem", { name: "관리 콘솔" }).click();
    await page
      .getByRole("navigation", { name: "관리 콘솔" })
      .getByRole("link", { name: "구성원" })
      .click();
    await page.getByRole("tab", { name: "초대" }).click();
    await page.getByRole("button", { name: "링크 만들기" }).click();
    const link = await page.locator("code").filter({ hasText: "/invite/" }).textContent();
    expect(link).toContain("/invite/");
    await signOut(page);

    // 2) 소속 없는 사용자는 온보딩으로 가고, 링크로 합류한다
    await loginAs(page, "신입사원");
    await expect(page).toHaveURL(/\/onboarding/);
    await page.getByLabel("초대 링크").fill(link ?? "");
    await page.getByRole("button", { name: "초대 확인" }).click();
    await expect(page).toHaveURL(/\/invite\//);
    await expect(page.getByText("포엠테스트(주)에 구성원(으)로 초대받았습니다.")).toBeVisible();
    await page.getByRole("button", { name: "초대 수락" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "포엠테스트(주)" })).toBeVisible();
    await signOut(page);

    // 3) 두 회사 소속자는 회사를 전환한다
    await loginAs(page, "한겸직");
    await page.getByRole("button", { name: "회사 전환" }).click();
    await page.getByRole("menuitem", { name: /다른회사\(주\)/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "다른회사(주)" })).toBeVisible();
  });

  test("내 정보에서 결재 PIN을 설정하고 세션·로그인 이력을 본다", async ({ page }) => {
    await loginAs(page, "최대리");
    await page.goto("/me");
    await page.getByRole("tab", { name: "결재 PIN" }).click();
    await page.getByLabel("새 PIN (숫자 6~12자리)").fill("482915");
    await page.getByLabel("PIN 다시 입력").fill("482915");
    await page.getByRole("button", { name: "설정" }).click();
    // 설정 토스트는 폼과 섹션에서 각각 한 번씩 떠 2건이 된다(strict mode 충돌) → 첫 건으로 본다
    await expect(page.getByText("PIN을 설정했습니다").first()).toBeVisible();

    await page.getByRole("tab", { name: "세션" }).click();
    await expect(page.getByText("현재")).toBeVisible();

    await page.getByRole("tab", { name: "로그인 이력" }).click();
    await expect(page.getByRole("cell", { name: "로그인" }).first()).toBeVisible();
  });

  test("비활성 구성원은 회사 화면에 들어가지 못한다", async ({ page }) => {
    await loginAs(page, "윤퇴사");
    await expect(page).toHaveURL(/\/onboarding/);
  });
});

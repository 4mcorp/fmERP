import { expect, type Locator, type Page, test } from "@playwright/test";

// passkey 흐름 화면을 1280px·360px 두 폭으로 캡처한다. 스크린샷은 testInfo.outputPath(test-results)에 저장되어 러너 artifacts로 수집된다.
// 흐름 자체는 passkey.spec.ts(PK2)와 같은 단계를 밟되, 한 번의 등록 흐름 안에서 뷰포트만 바꾼다(사전 등록 중복 방지).

const PIN = "482915";
const NEW_EMAIL = "passkey.screens@example.com";
const NEW_NAME = "스크린샷테스터";
const WIDTHS = [1280, 360] as const;

async function loginAs(page: Page, name: string) {
  await page.goto("/dev-login");
  await page.getByRole("button", { name: `${name}(으)로 로그인` }).click();
  await expect(page).not.toHaveURL(/\/dev-login/);
}

async function signOut(page: Page) {
  const done = page.waitForResponse((r) => r.url().includes("/api/auth/sign-out"));
  await page.getByRole("button", { name: "사용자 메뉴" }).click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  const res = await done;
  expect(res.status(), "로그아웃 응답은 성공이어야 한다").toBeLessThan(300);
  await expect(page).toHaveURL(/\/login/);
}

const VIRTUAL_OPTIONS = {
  protocol: "ctap2",
  transport: "internal",
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
} as const;

async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: VIRTUAL_OPTIONS,
  });
  return { cdp, authenticatorId };
}

function tokenLink(page: Page) {
  return page.locator("code").filter({ hasText: "/login?token=" });
}

async function tabTo(page: Page, target: Locator, max = 200) {
  for (let i = 0; i < max; i += 1) {
    const focused = await target.evaluate((el) => el === document.activeElement);
    if (focused) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab ${max}번 안에 포커스가 대상에 도달하지 않았다`);
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, "가로 스크롤이 없어야 한다").toBe(false);
}

/** 현재 뷰포트로 전체 화면을 찍어 테스트 산출물 폴더에 저장한다 */
async function capture(
  page: Page,
  testInfo: { outputPath: (name: string) => string },
  label: string,
) {
  const width = page.viewportSize()?.width ?? 0;
  const path = testInfo.outputPath(`${label}-${width}.png`);
  await page.screenshot({ path, fullPage: true });
  await assertNoHorizontalOverflow(page);
  return path;
}

// DB 상태를 바꾸므로 @stateful: 데스크톱 프로젝트에서 한 번 실행한다 (playwright.config.ts)
test.describe("passkey 화면 캡처 (1280px·360px)", { tag: "@stateful" }, () => {
  // 한 테스트가 등록·로그인·캡처 6회를 모두 수행하므로 기본 30초로는 모자라다.
  // 재시도는 DB 상태(PIN·등록 기기)를 되돌리지 않으므로 실패 시 재실행이 같은 결과를 내지 못한다.
  test.setTimeout(180_000);

  test("등록·로그인·내 기기 화면을 두 폭으로 캡처한다", async ({ page }, testInfo) => {
    const shots: string[] = [];
    await page.setViewportSize({ width: WIDTHS[0], height: 800 });
    const { cdp, authenticatorId } = await addVirtualAuthenticator(page);

    // 1) 관리자: PIN 설정 → 구성원 사전 등록 → 등록 링크
    await loginAs(page, "이관리");
    await page.goto("/me");
    await page.getByRole("tab", { name: "결재 PIN" }).click();
    await page.getByLabel("새 PIN (숫자 6~12자리)").fill(PIN);
    await page.getByLabel("PIN 다시 입력").fill(PIN);
    await page.getByRole("button", { name: "설정" }).click();
    await expect(page.getByText("PIN을 설정했습니다").first()).toBeVisible();

    await page.goto("/admin/members");
    await page.getByLabel("이메일", { exact: true }).fill(NEW_EMAIL);
    await page.getByLabel("이름", { exact: true }).fill(NEW_NAME);
    await page.getByRole("button", { name: "사전 등록" }).click();
    const pin = page.getByLabel("결재 PIN", { exact: true });
    if (
      await pin
        .waitFor({ state: "visible", timeout: 3000 })
        .then(() => true)
        .catch(() => false)
    ) {
      await pin.fill(PIN);
      await page.getByRole("button", { name: "확인하고 계속" }).click();
    }
    await expect(tokenLink(page)).toBeVisible();
    const enrollUrl = (await tokenLink(page).textContent()) ?? "";
    expect(enrollUrl).toContain("/login?token=");
    await signOut(page);

    // 2) 등록 링크 화면 (폭별 캡처) → 패스키 만들기
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(enrollUrl);
      await expect(page.getByRole("button", { name: "이 기기에 패스키 만들기" })).toBeVisible();
      shots.push(await capture(page, testInfo, "enroll"));
    }
    await page.setViewportSize({ width: WIDTHS[0], height: 800 });
    await page.goto(enrollUrl);
    await tabTo(page, page.getByRole("button", { name: "이 기기에 패스키 만들기" }));
    await page.keyboard.press("Enter");
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { level: 1, name: "포엠테스트(주)" })).toBeVisible();

    // 3) 로그인 화면 (폭별 캡처) → 패스키 로그인
    await signOut(page);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/login");
      await expect(page.getByRole("button", { name: "패스키로 로그인" })).toBeVisible();
      shots.push(await capture(page, testInfo, "login"));
    }
    await page.setViewportSize({ width: WIDTHS[0], height: 800 });
    await page.goto("/login");
    await page.getByRole("button", { name: "패스키로 로그인" }).click();
    await expect(page).not.toHaveURL(/\/login/);

    // 4) 내 기기 목록 (폭별 캡처)
    await page.goto("/me");
    await page.getByRole("tab", { name: "내 기기" }).click();
    const list = page.getByRole("list", { name: "등록된 기기" });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await expect(list.getByRole("listitem")).toHaveCount(1);
      shots.push(await capture(page, testInfo, "devices"));
    }

    // 정리: 가상 인증기 자격증명을 지운다 (다른 흐름이 같은 인증기를 쓰지 않도록)
    await cdp.send("WebAuthn.clearCredentials", { authenticatorId });
    expect(shots).toHaveLength(WIDTHS.length * 3);
  });
});

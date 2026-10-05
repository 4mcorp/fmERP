import { expect, type Page, test } from "@playwright/test";

async function loginAs(page: Page, name: string) {
  await page.goto("/dev-login");
  await page.getByRole("button", { name: `${name}(으)로 로그인` }).click();
  await expect(page).not.toHaveURL(/\/dev-login/);
}

/** 로그인한 사용자의 PIN을 확인 상태로 만든다. 이미 PIN이 있으면(M1 테스트 등) 알려진 값으로 확인한다 */
async function verifyPin(page: Page) {
  await page.request.put("/api/me/pin", { data: { pin: "246810" } });
  for (const pin of ["246810", "135790", "482915"]) {
    if ((await page.request.post("/api/me/pin/verify", { data: { pin } })).ok()) return;
  }
  throw new Error("PIN을 확인하지 못했습니다");
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

// E2E 환경에는 worker가 없어 요청한 덤프·내보내기는 "대기 중"에서 멈춘다. 실제 생성은 통합 테스트가 확인한다.
test.describe("덤프·내보내기 (M7)", () => {
  test("시스템 관리자가 수동 덤프를 요청하면 이력에 대기 중으로 보이고, 계정 관리자는 이 화면을 열 수 없다 @stateful", async ({
    page,
  }) => {
    await loginAs(page, "이관리");
    await page.goto("/system/backups");
    await expect(page.getByText("시스템 관리자만 열 수 있는 화면입니다")).toBeVisible();
    await page.getByRole("button", { name: "사용자 메뉴" }).click();
    await expect(page.getByRole("menuitem", { name: "시스템 덤프" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await loginAs(page, "김대표");
    await page.getByRole("button", { name: "사용자 메뉴" }).click();
    await page.getByRole("menuitem", { name: "시스템 덤프" }).click();
    await expect(page).toHaveURL(/\/system\/backups/);
    await expect(page.getByRole("heading", { level: 1, name: "시스템 덤프" })).toBeVisible();
    // 덤프 기록이 없으면 누락 경고가 보인다 (백업 상태 판정)
    await expect(page.getByText("자동 덤프가 기한 안에 성공하지 못했습니다")).toBeVisible();

    await verifyPin(page);
    await page.getByLabel("메모 (선택)").fill("E2E 점검");
    await page.getByRole("button", { name: "덤프 요청" }).click();
    await expect(page.getByText("덤프를 요청했습니다")).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "E2E 점검" });
    await expect(row.getByText("대기 중")).toBeVisible();
    // 대기·실행 중이면 또 요청할 수 없다
    await expect(page.getByRole("button", { name: "덤프 요청" })).toBeDisabled();
  });

  test("소유자가 내보내기를 요청하면 이력에 보이고, 허용 설정을 켜면 계정 관리자도 쓸 수 있다 @stateful", async ({
    page,
  }) => {
    await loginAs(page, "김대표");
    await verifyPin(page);
    await page.goto("/admin/backups");
    await expect(page.getByRole("heading", { level: 1, name: "계정 내보내기" })).toBeVisible();
    await page.getByRole("button", { name: "내보내기 요청" }).click();
    await expect(page.getByText("내보내기를 요청했습니다")).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "김대표" }).getByText("대기 중"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "내보내기 요청" })).toBeDisabled();

    // 계정 관리자는 허용되기 전에는 쓸 수 없다
    await loginAs(page, "이관리");
    await page.goto("/admin/backups");
    await expect(page.getByText("소유자만 할 수 있습니다")).toBeVisible();

    // 소유자가 허용하면 열린다
    await loginAs(page, "김대표");
    await page.goto("/admin/settings");
    await page.getByLabel("계정 관리자에게 계정 전체 내보내기를 허용한다").check();
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("계정 설정을 저장했습니다")).toBeVisible();
    await loginAs(page, "이관리");
    await page.goto("/admin/backups");
    await expect(page.getByRole("heading", { level: 1, name: "계정 내보내기" })).toBeVisible();
    await expect(page.getByText("계정 관리자에게 허용되어 있습니다")).toBeVisible();
    // 허용 설정 자체는 계정 관리자에게 보이지 않는다 (소유자만 바꾼다)
    await page.goto("/admin/settings");
    await expect(page.getByLabel("계정 관리자에게 계정 전체 내보내기를 허용한다")).toHaveCount(0);

    // 정리: 다른 테스트가 허용된 상태에 기대지 않도록 다시 끈다
    await loginAs(page, "김대표");
    await page.goto("/admin/settings");
    await page.getByLabel("계정 관리자에게 계정 전체 내보내기를 허용한다").uncheck();
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("계정 설정을 저장했습니다")).toBeVisible();
  });

  test("일반 구성원은 내보내기 메뉴가 없고 직접 열어도 쓸 수 없다", async ({ page }) => {
    await loginAs(page, "박사원");
    await page.goto("/admin/backups");
    await expect(page.getByText("관리 콘솔을 사용할 권한이 없습니다")).toBeVisible();
    const res = await page.request.get("/api/account/exports");
    expect(res.status()).toBe(403);
    const dump = await page.request.get("/api/system/backups");
    expect(dump.status()).toBe(404);
  });

  test("시스템 덤프와 내보내기 화면은 360px에서도 가로로 넘치지 않는다", async ({ page }) => {
    await loginAs(page, "김대표");
    await page.goto("/system/backups");
    await expect(page.getByRole("heading", { level: 1, name: "시스템 덤프" })).toBeVisible();
    await expectNoPageOverflow(page);
    await page.goto("/admin/backups");
    await expect(page.getByRole("heading", { level: 1, name: "계정 내보내기" })).toBeVisible();
    await expectNoPageOverflow(page);
  });
});

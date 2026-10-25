import { makeBusinessNumber } from "@fmerp/feature-org/domain/business-number";
import { expect, type Page, test } from "@playwright/test";

async function loginAs(page: Page, name: string) {
  await page.goto("/dev-login");
  await page.getByRole("button", { name: `${name}(으)로 로그인` }).click();
  await expect(page).not.toHaveURL(/\/dev-login/);
}

async function openAdmin(page: Page, tab: string) {
  await page.getByRole("button", { name: "사용자 메뉴" }).click();
  await page.getByRole("menuitem", { name: "관리 콘솔" }).click();
  await page
    .getByRole("navigation", { name: "관리 콘솔" })
    .getByRole("link", { name: tab })
    .click();
}

async function chooseOption(page: Page, label: string | RegExp, option: string | RegExp) {
  await page.getByRole("combobox", { name: label }).first().click();
  await page.getByRole("option", { name: option }).first().click();
}

test("일반 구성원은 조직도를 보지만 관리 콘솔은 쓸 수 없다", async ({ page }) => {
  await loginAs(page, "박사원");
  await page.getByRole("button", { name: "사용자 메뉴" }).click();
  await expect(page.getByRole("menuitem", { name: "관리 콘솔" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "조직도" }).click();
  await expect(page).toHaveURL(/\/org$/);
  await expect(page.getByRole("heading", { level: 1, name: "조직도" })).toBeVisible();
  await expect(page.getByText("경영지원본부").first()).toBeVisible();

  await page.getByLabel("부서 검색").fill("재무");
  await expect(page.getByText("재무팀").first()).toBeVisible();
  await expect(page.getByText("영업본부")).toHaveCount(0);

  await page.getByRole("tab", { name: "차트 보기" }).click();
  await expect(page.getByText("재무팀").first()).toBeVisible();

  await page.goto("/admin/org");
  await expect(page.getByText("관리 콘솔을 사용할 권한이 없습니다.")).toBeVisible();
});

test("360px 화면에서도 조직도·조직 관리가 가로 스크롤 없이 보인다", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "모바일 전용");
  await loginAs(page, "김대표");
  for (const path of ["/org", "/admin/org", "/admin/members", "/admin/settings"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, path).toBe(false);
  }
});

// 아래는 DB 상태를 바꾸므로 @stateful 태그를 달아 데스크톱 프로젝트에서만 한 번 실행한다 (playwright.config.ts)
test.describe("조직 구성 흐름 (M2)", { tag: "@stateful" }, () => {
  test("사업자 등록 검증, 부서 생성·뎁스 제한·이동", async ({ page }) => {
    await loginAs(page, "김대표");

    // 잘못된 사업자등록번호는 저장되지 않고, 올바른 번호는 등록된다 (S1)
    await openAdmin(page, "사업자");
    await page.getByRole("button", { name: "사업자 등록" }).click();
    await page.getByLabel("상호").fill("검증 사업자");
    await page.locator("#biz-bizRegNo").fill("123-45-67890");
    await page.getByLabel(/^사업자 코드/).fill("VB");
    await page.getByRole("button", { name: "등록", exact: true }).click();
    await expect(page.getByText(/사업자등록번호가 올바르지 않습니다/)).toBeVisible();
    await page.locator("#biz-bizRegNo").fill(makeBusinessNumber("300123456"));
    await page.getByRole("button", { name: "등록", exact: true }).click();
    await expect(page.getByText("사업자를 등록했습니다")).toBeVisible();

    // 부서: 최대 3단계 — 자금파트(3단계) 아래 하위 추가는 막힌다 (S2)
    await openAdmin(page, "조직");
    await expect(page.getByRole("heading", { level: 1, name: "조직 관리" })).toBeVisible();
    await expect(page.getByRole("button", { name: "자금파트 하위 추가" })).toBeDisabled();

    // 최상위 부서 → 하위 부서 생성
    await page.getByRole("button", { name: "최상위 부서 추가" }).click();
    await page.getByLabel("부서명").fill("품질본부");
    await page.getByLabel(/^부서 코드/).fill("QA");
    await page.getByRole("button", { name: "만들기" }).click();
    await expect(page.getByText("부서를 만들었습니다")).toBeVisible();
    await page.getByRole("button", { name: "품질본부 하위 추가" }).click();
    await page.getByLabel("부서명").fill("검사팀");
    await page.getByLabel(/^부서 코드/).fill("QA1");
    await page.getByRole("button", { name: "만들기" }).click();
    await expect(page.getByText("검사팀").first()).toBeVisible();
    await expect(
      page.locator("li", { hasText: "검사팀" }).first().getByText("2단계"),
    ).toBeVisible();

    // 수정 화면에서 상위 부서를 바꿔 이동한다 (끌어놓기와 같은 API)
    await page.getByRole("button", { name: "검사팀 수정" }).click();
    await chooseOption(page, /^상위 부서/, "경영지원본부");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByText("부서를 수정했습니다")).toBeVisible();

    // 계정 설정에서 최대 뎁스를 1로 낮추면 넘는 부서 목록과 함께 거부된다 (S2)
    await openAdmin(page, "계정 설정");
    await chooseOption(page, "최대 뎁스", "1단계");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByText(/단계를 넘는 부서가 있어 줄일 수 없습니다/)).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "자금파트 (3단계)" })).toBeVisible();
  });

  test("구성원에게 겸직 발령과 역할을 부여하면 조직도·이력에 반영된다", async ({ page }) => {
    await loginAs(page, "이관리");
    await openAdmin(page, "구성원");
    await page.getByRole("button", { name: "박사원 관리" }).click();

    // 겸직 추가: 포엠물류 물류팀
    await page.getByRole("button", { name: "겸직·소속 추가" }).click();
    await page.getByRole("combobox", { name: "사업자" }).last().click();
    await page.getByRole("option", { name: "포엠물류" }).click();
    await page.getByRole("combobox", { name: "부서" }).last().click();
    await page.getByRole("option", { name: "물류팀" }).click();
    await page.getByLabel("발령 사유 (선택)").fill("프로젝트 파견");
    await page.getByRole("button", { name: "발령 저장" }).click();
    await expect(page.getByText("발령을 저장했습니다")).toBeVisible();
    await expect(page.getByRole("row", { name: /발령 .*프로젝트 파견/ })).toBeVisible();

    // 역할 부여: 감사인(계정 전체)
    await page.getByRole("combobox", { name: "역할" }).last().click();
    await page.getByRole("option", { name: "감사인" }).first().click();
    await page.getByRole("button", { name: "부여" }).click();
    await expect(page.getByText("역할을 부여했습니다")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "감사인" })).toBeVisible();
    await page.getByRole("button", { name: "회수" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "회수", exact: true }).click();
    await expect(page.getByText("역할을 회수했습니다")).toBeVisible();
  });

  test("부서를 미리 지정한 초대 링크를 만든다", async ({ page }) => {
    await loginAs(page, "오사업");
    await openAdmin(page, "구성원");
    await page.getByRole("tab", { name: "초대" }).click();
    // 사업자 관리자는 관리자 역할 초대를 할 수 없다 (옵션이 없다)
    await page.getByRole("combobox", { name: "역할" }).click();
    await expect(page.getByRole("option", { name: "관리자" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await chooseOption(page, "사업자", "포엠테스트 본사");
    await chooseOption(page, "부서", "영업본부");
    await page.getByRole("button", { name: "링크 만들기" }).click();
    await expect(page.locator("code").filter({ hasText: "/invite/" })).toBeVisible();
    await expect(page.getByRole("row", { name: /영업본부/ }).first()).toBeVisible();
  });
});

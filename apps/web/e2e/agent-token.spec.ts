import { expect, test } from "@playwright/test";

// trace는 describe가 아니라 파일 단위 옵션이다. 토큰·PIN을 산출물에 기록하지 않는다.
test.use({ trace: "off" });

test(
  "1280·360px 에이전트 토큰 발급·한 번 표시·폐기",
  { tag: "@stateful" },
  async ({ page }, testInfo) => {
    await page.addInitScript(() =>
      window.sessionStorage.setItem("pin-setup-remind-dismissed", "1"),
    );
    await page.goto("/dev-login");
    await page.getByRole("button", { name: "정대표(으)로 로그인" }).click();
    await expect(page).not.toHaveURL(/\/dev-login/);
    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/me?tab=agents");
      await expect(page.getByRole("heading", { level: 1, name: "내 정보" })).toBeVisible();
      await page.waitForLoadState("networkidle");
      const me = await page.request.get("/api/me").then((response) => response.json());
      const name = `연결 시험 ${width} ${testInfo.retry}`;
      await page.getByLabel("연결 이름", { exact: true }).fill(name);
      await page.getByLabel("조직 조회", { exact: true }).check();
      await page
        .getByLabel("외부 AI에 데이터가 전달될 수 있음을 이해하고 선택한 권한으로 발급합니다.")
        .check();
      await page.getByRole("button", { name: "PIN 확인 후 토큰 발급" }).click();
      if (!me.hasPin) {
        const setup = page.getByRole("dialog", { name: "결재 PIN 설정이 필요합니다" });
        await expect(setup).toBeVisible();
        await setup.getByLabel("새 PIN (숫자 6~12자리)", { exact: true }).fill("246810");
        await setup.getByLabel("PIN 다시 입력").fill("246810");
        await setup.getByRole("button", { name: "설정하고 계속" }).click();
      }
      const dialog = page.getByRole("dialog", { name: "결재 PIN 확인" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("결재 PIN", { exact: true }).fill("246810");
      await dialog.getByRole("button", { name: "확인", exact: true }).click();
      const secret = page.getByRole("textbox", { name: "발급된 토큰", exact: true });
      try {
        await expect(secret).toBeVisible();
        expect(
          await secret
            .inputValue()
            .then((value) => /^fmerp_agent_[0-9a-f-]+\.[A-Za-z0-9_-]{43}$/.test(value)),
        ).toBe(true);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`agent-${width}.png`),
          fullPage: true,
          mask: [secret],
        });
        await page.getByRole("button", { name: "저장했습니다. 토큰 숨기기" }).click();
        await expect(secret).toHaveCount(0);
      } finally {
        // 실패 error-context에도 평문이 남지 않도록 화면을 비운다.
        await page.reload();
      }
      await expect(page.getByRole("button", { name: `${name} 토큰 폐기` })).toBeVisible();
      await expect(secret).toHaveCount(0);
      await page.getByRole("button", { name: `${name} 토큰 폐기` }).click();
      await expect(
        page.getByRole("listitem").filter({ hasText: name }).getByText("폐기됨"),
      ).toBeVisible();
    }
  },
);

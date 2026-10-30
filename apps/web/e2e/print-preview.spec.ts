import { expect, type Page, test } from "@playwright/test";

async function loginAs(page: Page, name: string) {
  // 시드 계정은 PIN이 없어 로그인 직후 PIN 설정 안내 모달이 뜨고 이후 클릭을 가로챈다 — 안내는 닫은 상태로 시작한다
  await page.addInitScript(() => window.sessionStorage.setItem("pin-setup-remind-dismissed", "1"));
  await page.goto("/dev-login");
  await page.getByRole("button", { name: `${name}(으)로 로그인` }).click();
  await expect(page).not.toHaveURL(/\/dev-login/);
}

const EMPTY_DOC = { type: "doc", content: [] };

/** 기안자로서 최대리를 결재자로 하는 문서를 만들어 상신하고 문서 ID를 돌려준다 */
async function submitDoc(page: Page, title: string) {
  const get = async <T>(url: string) => (await (await page.request.get(url)).json()) as T;
  const forms = await get<{ id: string; code: string }[]>("/api/forms");
  const members = await get<{ email: string; membershipId: string }[]>("/api/account/members");
  const businesses = await get<{ id: string; code: string }[]>("/api/businesses");
  const approver = members.find((m) => m.email === "member2@example.com");
  const created = await page.request.post("/api/approvals", {
    data: {
      businessId: businesses.find((b) => b.code === "FM")?.id,
      formId: forms.find((f) => f.code === "GENERAL")?.id,
      title,
      body: { body: EMPTY_DOC },
      line: [
        { type: "approve", seq: 1, target: { kind: "user", membershipId: approver?.membershipId } },
      ],
    },
  });
  expect(created.ok()).toBe(true);
  const { documentId } = (await created.json()) as { documentId: string };
  expect((await page.request.post(`/api/approvals/${documentId}/submit`, { data: {} })).ok()).toBe(
    true,
  );
  return documentId;
}

test("결재 상세 카드는 1920px부터 최대 5열이고 본문은 전체 폭이다 @stateful", async ({
  page,
}, testInfo) => {
  await loginAs(page, "박사원");
  const id = await submitDoc(page, unique("E2E 카드 열 수"));
  await page.goto(`/approval/${id}`);
  const grid = page.locator('[data-slot="card-grid"]');
  await expect(grid).toBeVisible();
  for (const [width, columns] of [
    [360, 1],
    [1280, 3],
    [1536, 4],
    [1919, 4],
    [1920, 5],
    [2560, 5],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length),
      )
      .toBe(columns);
    const toggles = grid.locator('[data-slot="collapsible-card"] > div:first-child > button');
    expect(await toggles.count()).toBeGreaterThan(0);
    for (const toggle of await toggles.all()) {
      const title = await toggle
        .locator("span")
        .first()
        .evaluate((element) => ({
          height: element.getBoundingClientRect().height,
          lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
        }));
      expect(title.height).toBeLessThanOrEqual(title.lineHeight + 1);
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
    }
    const gridBox = await grid.boundingBox();
    const full = grid.locator('[data-slot="card-grid-full"]');
    expect(await full.count()).toBeGreaterThan(0);
    for (const card of await full.all()) {
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(Math.abs((box?.width ?? 0) - (gridBox?.width ?? 0))).toBeLessThan(1);
    }
    await page.screenshot({ path: testInfo.outputPath(`card-grid-${width}.png`), fullPage: true });
  }
});

const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

test.describe("출력 미리보기 모달 (계획 2.3, AUD-020)", () => {
  test("인쇄 버튼은 미리보기 모달을 먼저 열고 진행 중 표시를 보여 준다 @stateful", async ({
    page,
  }) => {
    await loginAs(page, "박사원");
    const id = await submitDoc(page, unique("E2E 미리보기"));
    await page.goto(`/approval/${id}`);
    await page.getByRole("button", { name: "인쇄", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "출력 미리보기" });
    await expect(dialog).toBeVisible();
    const frame = dialog.frameLocator('iframe[title="출력 미리보기"]');
    await expect(frame.getByText("결재 진행 중 (미완료)")).toBeVisible();
  });

  test("용지는 넓은 화면에서 중앙 정렬되고 리사이즈해도 본문 폭은 유지된다 @stateful", async ({
    page,
  }, testInfo) => {
    await loginAs(page, "박사원");
    const id = await submitDoc(page, unique("E2E A4 중앙 정렬"));
    await page.goto(`/approval/${id}`);
    await page.getByRole("button", { name: "인쇄", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "출력 미리보기" });
    const preview = dialog.locator('[data-slot="a4-preview-frame"]');
    const iframe = preview.locator("iframe");
    await expect(iframe).toBeVisible();
    const originalHtml = await iframe.getAttribute("srcdoc");
    const originalSandbox = await iframe.getAttribute("sandbox");
    const originalWidth = await iframe.evaluate((element) => element.clientWidth);
    for (const [width, height] of [
      [1280, 900],
      [360, 780],
      [390, 844],
      [844, 390],
      [1280, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(() =>
          preview.evaluate((element) => {
            const container = element.getBoundingClientRect();
            const paper = element.firstElementChild?.getBoundingClientRect();
            if (!paper) return Number.POSITIVE_INFINITY;
            return Math.abs(paper.left - container.left - (container.width - paper.width) / 2);
          }),
        )
        .toBeLessThan(1);
      expect(await iframe.evaluate((element) => element.clientWidth)).toBe(originalWidth);
      await expect(iframe).toHaveAttribute("srcdoc", originalHtml ?? "");
      await expect(iframe).toHaveAttribute("sandbox", originalSandbox ?? "");
      await page.screenshot({ path: testInfo.outputPath(`a4-center-${width}x${height}.png`) });
    }
  });

  test("Esc로 미리보기를 닫고, 미리보기만 연 것은 인쇄 기록을 남기지 않는다 @stateful", async ({
    page,
  }) => {
    await loginAs(page, "박사원");
    const id = await submitDoc(page, unique("E2E 미리보기 Esc"));
    await page.goto(`/approval/${id}`);

    const printLogs: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes(`/api/approvals/${id}/print-log`)) printLogs.push(r.method());
    });

    await page.getByRole("button", { name: "인쇄", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "출력 미리보기" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(printLogs).toEqual([]);
  });

  test("미리보기의 인쇄 버튼을 누르면 인쇄 기록을 남긴다 @stateful", async ({ page }) => {
    // 헤드리스 브라우저에서 인쇄 대화상자가 뜨지 않도록 막는다
    await page.addInitScript(() => {
      window.print = () => {};
    });
    await loginAs(page, "박사원");
    const id = await submitDoc(page, unique("E2E 미리보기 인쇄"));
    await page.goto(`/approval/${id}`);
    await page.getByRole("button", { name: "인쇄", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "출력 미리보기" });
    await expect(dialog).toBeVisible();
    const logged = page.waitForResponse(
      (r) => r.url().includes(`/api/approvals/${id}/print-log`) && r.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "인쇄", exact: true }).click();
    expect((await logged).ok()).toBe(true);
  });
});

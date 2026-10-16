import { expect, type Page, test } from "@playwright/test";

async function loginAs(page: Page, name: string) {
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

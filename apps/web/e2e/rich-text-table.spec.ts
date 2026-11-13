import { spawn } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv } from "./test-env";

async function login(page: Page, name: string) {
  await page.addInitScript(() => sessionStorage.setItem("pin-setup-remind-dismissed", "1"));
  await page.goto("/dev-login");
  await page.getByRole("button", { name: `${name}(으)로 로그인` }).click();
  await expect(page).not.toHaveURL(/dev-login/, { timeout: 60_000 });
}

test("리치텍스트 표를 저장·재편집·완료 PDF로 보존한다 @stateful", async ({ page }) => {
  test.setTimeout(480_000);
  await login(page, "박사원");
  const forms = await (await page.request.get("/api/forms")).json();
  const businesses = await (await page.request.get("/api/businesses")).json();
  const members = await (await page.request.get("/api/account/members")).json();
  const response = await page.request.post("/api/approvals", {
    data: {
      businessId: businesses.find((b: { code: string }) => b.code === "FM").id,
      formId: forms.find((f: { code: string }) => f.code === "GENERAL").id,
      title: `표 검증 ${Date.now()}`,
      body: { body: { type: "doc", content: [] } },
      line: [
        {
          type: "approve",
          seq: 1,
          target: {
            kind: "user",
            membershipId: members.find((m: { email: string }) => m.email === "member2@example.com")
              .membershipId,
          },
        },
      ],
      submit: false,
    },
  });
  expect(response.status()).toBe(201);
  const { documentId } = await response.json();
  await page.goto(`/approval/draft/${documentId}`);
  const editable = page.locator('.form-blocks[data-mode="fill"] .ProseMirror');
  await editable.click();
  await editable.evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/html", '<table><tr><td colspan="999999999">악성</td></tr></table>');
    data.setData("text/plain", "안전한 일반 텍스트");
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
    );
  });
  await expect(editable).toContainText("안전한 일반 텍스트");
  await expect(editable.locator("table")).toHaveCount(0);
  await editable.evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/plain", "x".repeat(100001));
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
    );
  });
  await expect(editable).toContainText("안전한 일반 텍스트");
  await expect(editable).not.toContainText("xxxxxxxxxx");
  await page.getByRole("button", { name: "표 삽입", exact: true }).click();
  const table = page.locator('.form-blocks[data-mode="fill"] .ProseMirror table');
  await expect(table.locator("tr")).toHaveCount(3);
  await table.locator("th").first().click();
  await page.keyboard.insertText("항목명");
  await table.locator("td").first().click();
  await page.keyboard.insertText("첫 저장");
  await page.getByRole("button", { name: "임시저장", exact: true }).click();
  await expect(page.getByText(/저장됨/)).toBeVisible();
  await page.reload();
  await expect(table).toContainText("첫 저장");
  await table.locator("td").first().click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" 수정");
  await page.getByRole("button", { name: "임시저장", exact: true }).click();
  await expect(page.getByText(/저장됨/)).toBeVisible();
  await page.reload();
  await expect(table).toContainText("첫 저장 수정");
  const body = await (await page.request.get(`/api/approvals/${documentId}/body`)).json();
  expect(JSON.stringify(body.body)).toContain("첫 저장 수정");
  const pinSet = await page.request.put("/api/me/pin", { data: { pin: "135790" } });
  expect(pinSet.ok()).toBeTruthy();
  expect(
    (await page.request.post("/api/me/pin/verify", { data: { pin: "135790" } })).ok(),
  ).toBeTruthy();
  await page.getByRole("button", { name: "상신", exact: true }).click();
  await expect(page).toHaveURL(`/approval/${documentId}`, { timeout: 90_000 });
  const view = page.locator('.form-blocks[data-mode="view"]');
  await expect(view.locator("table")).toContainText("첫 저장 수정");
  await expect(view.locator("[contenteditable=true]")).toHaveCount(0);
  await login(page, "최대리");
  expect((await page.request.put("/api/me/pin", { data: { pin: "135790" } })).ok()).toBeTruthy();
  expect(
    (await page.request.post("/api/me/pin/verify", { data: { pin: "135790" } })).ok(),
  ).toBeTruthy();
  const approval = await (await page.request.get(`/api/approvals/${documentId}`)).json();
  const step = approval.steps.find((s: { status: string }) => s.status === "ACTIVE");
  expect(
    (
      await page.request.post(`/api/approvals/${documentId}/steps/${step.id}/act`, {
        data: {
          action: { kind: "approve" },
          idempotencyKey: crypto.randomUUID(),
          expectedVersion: step.version,
        },
      })
    ).ok(),
  ).toBeTruthy();
  const worker = spawn("../../node_modules/.bin/tsx", ["../worker/src/main.ts"], {
    env: { ...process.env, ...e2eEnv, NODE_ENV: "development", WORKER_PORT: "33091" },
    stdio: "inherit",
  });
  try {
    await expect
      .poll(
        async () => (await page.request.get(`/api/approvals/${documentId}/package/pdf`)).status(),
        { timeout: 150_000, intervals: [3000] },
      )
      .toBe(200);
    const link = await page.request.get(`/api/approvals/${documentId}/package/pdf`);
    const { url } = await link.json();
    const pdf = await page.request.get(url);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  } finally {
    worker.kill("SIGTERM");
  }
});

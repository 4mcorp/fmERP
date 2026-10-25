import { expect, type Page, test } from "@playwright/test";

async function loginAs(page: Page, name: string) {
  await page.goto("/dev-login");
  await page.getByRole("button", { name: `${name}(으)로 로그인` }).click();
  await expect(page).not.toHaveURL(/\/dev-login/);
}

/** 접힌 CollapsibleCard를 펼친다. 머리줄(토글 버튼)이 그려질 때까지 기다린 뒤, 접혀 있을 때만 누른다 */
async function expandCard(page: Page, name: RegExp) {
  const toggle = page
    .locator('[data-slot="collapsible-card"] button[aria-expanded]')
    .filter({ hasText: name })
    .first();
  await toggle.waitFor();
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
}

const EMPTY_DOC = { type: "doc", content: [] };

/** 로그인한 사용자의 PIN을 확인 상태로 만든다. 이미 PIN이 있으면(M1 테스트 등) 알려진 값으로 확인한다 */
async function verifyPin(page: Page) {
  const set = await page.request.put("/api/me/pin", { data: { pin: "135790" } });
  const candidates = set.ok() ? ["135790"] : ["482915", "135790"];
  for (const pin of candidates) {
    const res = await page.request.post("/api/me/pin/verify", { data: { pin } });
    if (res.ok()) return pin;
  }
  throw new Error("PIN을 확인하지 못했습니다");
}

interface Ref {
  forms: { id: string; code: string }[];
  members: { email: string; membershipId: string }[];
  businesses: { id: string; code: string }[];
  departments: { id: string; code: string }[];
}

async function refs(page: Page): Promise<Ref> {
  const get = async <T>(url: string) => (await (await page.request.get(url)).json()) as T;
  return {
    forms: await get("/api/forms"),
    members: await get("/api/account/members"),
    businesses: await get("/api/businesses"),
    departments: await get("/api/departments"),
  };
}

/** 기안자로서 초안을 만들고(필요하면 수신·참조를 지정하고) 상신한다 */
async function submitDoc(
  page: Page,
  title: string,
  approverEmail: string,
  recipients: { kind: "cc" | "receive"; type: "member" | "department"; id: string }[] = [],
) {
  const r = await refs(page);
  const approver = r.members.find((m) => m.email === approverEmail);
  const created = await page.request.post("/api/approvals", {
    data: {
      businessId: r.businesses.find((b) => b.code === "FM")?.id,
      formId: r.forms.find((f) => f.code === "GENERAL")?.id,
      title,
      body: { body: EMPTY_DOC },
      line: [
        { type: "approve", seq: 1, target: { kind: "user", membershipId: approver?.membershipId } },
      ],
    },
  });
  expect(created.ok()).toBe(true);
  const { documentId } = (await created.json()) as { documentId: string };
  if (recipients.length > 0) {
    const put = await page.request.put(`/api/approvals/${documentId}/recipients`, {
      data: {
        items: recipients.map((x) => ({ kind: x.kind, target: { type: x.type, id: x.id } })),
      },
    });
    expect(put.ok()).toBe(true);
  }
  expect((await page.request.post(`/api/approvals/${documentId}/submit`, { data: {} })).ok()).toBe(
    true,
  );
  return documentId;
}

/** 결재자로서 첫 단계를 승인한다 */
async function approve(page: Page, documentId: string) {
  await verifyPin(page);
  const view = (await (await page.request.get(`/api/approvals/${documentId}`)).json()) as {
    steps: { id: string; status: string; version: number }[];
  };
  const step = view.steps.find((s) => s.status === "ACTIVE");
  const res = await page.request.post(`/api/approvals/${documentId}/steps/${step?.id}/act`, {
    data: {
      action: { kind: "approve" },
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: step?.version,
    },
  });
  expect(res.ok()).toBe(true);
}

/** 박사원이 상신하고 최대리가 승인해 완료된 문서를 만든다 */
async function completedDoc(
  page: Page,
  title: string,
  recipients: Parameters<typeof submitDoc>[3] = [],
) {
  await loginAs(page, "박사원");
  const id = await submitDoc(page, title, "member2@example.com", recipients);
  await loginAs(page, "최대리");
  await approve(page, id);
  return id;
}

const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

test.describe("완료 처리·문서함 (M5)", () => {
  test("완료 문서가 완료함에 나타나고 검색으로 찾아 열 수 있으며 PDF 상태가 보인다 @stateful", async ({
    page,
  }) => {
    const title = unique("E2E 완료 정산");
    const id = await completedDoc(page, title);

    await loginAs(page, "박사원");
    await page
      .getByRole("navigation", { name: "주 메뉴" })
      .getByRole("link", { name: "문서함" })
      .click();
    await expect(page).toHaveURL(/\/mailbox\/progress/);
    await page.getByRole("link", { name: "완료함" }).click();
    await expect(page).toHaveURL(/\/mailbox\/completed/);
    await expect(page.getByRole("link", { name: title })).toBeVisible();

    await page.getByRole("link", { name: "검색" }).click();
    await page.getByRole("searchbox", { name: "검색어" }).fill(title);
    await page.getByRole("button", { name: "검색" }).click();
    await expect(page).toHaveURL(/q=/);
    await page.getByRole("link", { name: title }).click();
    await expect(page).toHaveURL(new RegExp(`/approval/${id}`));
    // worker가 PDF를 만들기 전이므로 생성 중으로 보이고, 만들어지면 내려받기 버튼이 나온다
    await expect(page.getByText("결재 완료 문서")).toBeVisible();
    await expect(page.getByText(/PDF 생성 중|PDF 내려받기/).first()).toBeVisible();
  });

  test("수신 부서장이 접수·배부하고 기안자는 상태를 본다 @stateful", async ({ page }) => {
    await loginAs(page, "박사원");
    const r = await refs(page);
    const mgt = r.departments.find((d) => d.code === "MGT");
    const hr = r.members.find((m) => m.email === "hr@example.com");
    const title = unique("E2E 수신 문서");
    const id = await submitDoc(page, title, "member2@example.com", [
      { kind: "receive", type: "department", id: mgt?.id ?? "" },
      { kind: "cc", type: "member", id: hr?.membershipId ?? "" },
    ]);
    await loginAs(page, "최대리");
    await approve(page, id);

    // 접수 담당자(경영지원본부 부서장 오사업)는 접수 전에도 문서를 열어 접수한다
    await loginAs(page, "오사업");
    await page.goto("/mailbox/receive");
    await page.getByRole("link", { name: title }).click();
    // 수신·참조 상태는 접힌 "참조·수신·공람" 카드 안에 있다
    await expandCard(page, /^참조·수신·공람/);
    await expect(page.getByText("접수 대기")).toBeVisible();
    await page.getByRole("button", { name: "접수", exact: true }).click();
    await expect(page.getByText(/오사업 접수/)).toBeVisible();

    await page.getByRole("button", { name: "배부" }).click();
    await page.getByRole("checkbox", { name: "김대표" }).check();
    await page.getByRole("dialog").getByRole("button", { name: "배부" }).click();
    await expect(page.getByText(/배부: 김대표/)).toBeVisible();

    // 기안자는 접수·배부 상태를 본다
    await loginAs(page, "박사원");
    await page.goto(`/approval/${id}`);
    await expandCard(page, /^참조·수신·공람/);
    await expect(page.getByText(/오사업 접수/)).toBeVisible();
    await expect(page.getByText(/배부: 김대표/)).toBeVisible();
  });

  test("완료 문서를 공람으로 지정하면 대상자가 공람함에서 열고 기안자가 열람 현황을 본다 @stateful", async ({
    page,
  }) => {
    const title = unique("E2E 공람 문서");
    const id = await completedDoc(page, title);

    await loginAs(page, "박사원");
    await page.goto(`/approval/${id}`);
    await expandCard(page, /^참조·수신·공람/);
    await page.getByRole("button", { name: "공람 지정" }).click();
    await page.getByRole("combobox", { name: "공람 대상 추가" }).click();
    await page.getByRole("option", { name: "송인사" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "지정" }).click();
    await expect(page.getByText("송인사").first()).toBeVisible();

    await loginAs(page, "송인사");
    await page.goto("/mailbox/circulate");
    await page.getByRole("link", { name: title }).click();
    await expect(page.getByText("결재 완료 문서")).toBeVisible();

    await loginAs(page, "박사원");
    await page.goto(`/approval/${id}`);
    await expandCard(page, /^참조·수신·공람/);
    await expect(page.getByText(/송인사 · .* 열람/)).toBeVisible();
  });

  test("결재 관리자가 결재자를 일괄 이관하면 새 결재자의 결재 대기로 넘어간다 @stateful", async ({
    page,
  }) => {
    await loginAs(page, "박사원");
    const title = unique("E2E 이관 문서");
    await submitDoc(page, title, "hr@example.com");

    await loginAs(page, "결재관리");
    await verifyPin(page);
    await page.goto("/admin/approvals");
    await expect(page.getByRole("heading", { level: 1, name: "결재 문서 관리" })).toBeVisible();
    await page.getByRole("combobox", { name: "이관할 사람" }).click();
    await page.getByRole("option", { name: "송인사" }).click();
    await page.getByRole("combobox", { name: "대체 결재자" }).click();
    await page.getByRole("option", { name: "최대리" }).click();
    await page.getByRole("textbox", { name: /사유/ }).fill("E2E 인수인계");
    await page.getByRole("button", { name: "이관", exact: true }).click();
    await expect(page.getByText(/이관했습니다/)).toBeVisible();

    await loginAs(page, "최대리");
    await page.goto("/approval/pending");
    await expect(page.getByRole("link", { name: title })).toBeVisible();
  });

  test("360px 모바일에서 문서함·검색이 가로 스크롤 없이 보인다", async ({ page }) => {
    await loginAs(page, "박사원");
    for (const path of ["/mailbox/progress", "/mailbox/completed", "/search?q=E2E"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});

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

/** 페이지 전체가 가로로 넘치지 않는지 (표는 자체 가로 스크롤이므로 제외) */
async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("감사 기능 (M6)", () => {
  test("감사인은 문서를 읽기 전용으로 보고 이력에 감사 열람이 남는다 @stateful", async ({
    page,
  }) => {
    await loginAs(page, "박사원");
    const title = unique("E2E 감사 열람");
    const id = await submitDoc(page, title);

    await loginAs(page, "감사인");
    await page.goto(`/approval/${id}`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    // 읽기 전용: 의견을 쓸 수 없고 결재 처리 버튼도 없다
    await expect(page.getByText("열람 권한으로 보고 있어 의견을 남길 수 없습니다")).toBeVisible();
    await expect(page.getByRole("button", { name: "의견 등록" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "승인" })).toHaveCount(0);
    // 이력: 상신과, 방금 한 열람(접속지 포함)
    const timeline = page.getByRole("listitem").filter({ hasText: "감사 열람" });
    await expect(timeline.first()).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "상신" }).first()).toBeVisible();
  });

  test("인쇄 버튼을 누르면 인쇄가 이력에 기록된다 @stateful", async ({ page }) => {
    // 헤드리스 브라우저에서 인쇄 대화상자가 뜨지 않도록 막는다
    await page.addInitScript(() => {
      window.print = () => {};
    });
    await loginAs(page, "박사원");
    const id = await submitDoc(page, unique("E2E 인쇄 기록"));
    await page.goto(`/approval/${id}`);
    const logged = page.waitForResponse(
      (r) => r.url().includes(`/api/approvals/${id}/print-log`) && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "인쇄" }).click();
    expect((await logged).ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole("listitem").filter({ hasText: "인쇄" }).first()).toBeVisible();
  });

  test("관리자가 감사 로그를 문서 ID로 걸러 보고 상세를 연다 @stateful", async ({ page }) => {
    await loginAs(page, "박사원");
    const id = await submitDoc(page, unique("E2E 로그 조회"));

    await loginAs(page, "김대표");
    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { level: 1, name: "감사 로그" })).toBeVisible();
    await page.getByLabel("대상 ID").fill(id);
    await page.getByRole("button", { name: "조회" }).click();
    await expect(page).toHaveURL(/targetId=/);
    await expect(page.getByRole("button", { name: /결재 작성 상세 보기/ })).toBeVisible();
    await page.getByRole("button", { name: /상신 상세 보기/ }).click();
    const dialog = page.getByRole("dialog", { name: "감사 로그 상세" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(id).first()).toBeVisible();
    await dialog.getByRole("button", { name: "닫기" }).click();
    await expect(dialog).toBeHidden();
  });

  test("관리자는 감사 로그에서 문서 제목을 볼 수 없다 @stateful", async ({ page }) => {
    await loginAs(page, "박사원");
    const title = unique("E2E 비밀 제목");
    const id = await submitDoc(page, title);

    await loginAs(page, "이관리");
    await page.goto(`/admin/audit?targetId=${id}`);
    await expect(page.getByText(/문서 내용 가림/).first()).toBeVisible();
    await expect(page.getByText(title)).toHaveCount(0);
    await page.getByRole("button", { name: /상신 상세 보기/ }).click();
    await expect(
      page.getByText("문서를 열람할 권한이 없어 제목·결재 의견·첨부 이름은 가렸습니다"),
    ).toBeVisible();
  });

  test("월간 접속 기록 점검을 기록하면 상태가 점검 완료로 바뀌고 점검 필요 표시가 사라진다 @stateful", async ({
    page,
  }) => {
    await loginAs(page, "김대표");
    await page.goto("/admin/audit/review");
    await expect(page.getByRole("heading", { level: 1, name: "감사 로그" })).toBeVisible();
    // 이미 점검한 상태로 시작할 수도 있어, 버튼 이름(점검 완료 기록 / 다시 점검 기록)을 모두 받는다
    await page
      .getByRole("button", { name: /점검 완료 기록|다시 점검 기록/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: /접속 기록 점검/ });
    await dialog.getByLabel("메모 (선택)").fill("E2E 점검");
    await dialog.getByRole("button", { name: "점검 완료" }).click();
    await expect(page.getByText(/점검을 기록했습니다/)).toBeVisible();
    const firstRow = page.getByRole("row").nth(1);
    await expect(firstRow.getByText("점검 완료", { exact: true })).toBeVisible();
    await expect(firstRow.getByText("E2E 점검")).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "관리 콘솔" }).getByText("점검 필요"),
    ).toHaveCount(0);
  });

  test("일반 구성원과 부서 범위 감사인은 감사 로그 화면을 쓸 수 없다", async ({ page }) => {
    for (const name of ["박사원", "감사인"]) {
      await loginAs(page, name);
      await page.goto("/admin/audit");
      await expect(page.getByText("관리 콘솔을 사용할 권한이 없습니다")).toBeVisible();
      const res = await page.request.get("/api/audit-logs");
      expect(res.status()).toBe(403);
    }
  });

  test("감사 로그와 월간 점검 화면은 360px에서도 쓸 수 있다", async ({ page }) => {
    await loginAs(page, "김대표");
    await page.goto("/admin/audit");
    await expect(page.getByRole("button", { name: "조회" })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await expectNoPageOverflow(page);
    await page.goto("/admin/audit/review");
    await expect(page.getByRole("table")).toBeVisible();
    await expectNoPageOverflow(page);
  });
});

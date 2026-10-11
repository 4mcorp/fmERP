import { expect, type Page, test } from "@playwright/test";

async function loginAs(page: Page, name: string) {
  await page.goto("/dev-login");
  await page.getByRole("button", { name: `${name}(으)로 로그인` }).click();
  await expect(page).not.toHaveURL(/\/dev-login/);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "사용자 메뉴" }).click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/dev-login/);
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

/** 기안자로서 API로 문서를 빠르게 만들어 상신한다 (화면 흐름은 별도 테스트가 확인한다) */
async function submitDoc(page: Page, title: string, approverEmail: string) {
  const forms = (await (await page.request.get("/api/forms")).json()) as {
    id: string;
    code: string;
  }[];
  const members = (await (await page.request.get("/api/account/members")).json()) as {
    email: string;
    membershipId: string;
  }[];
  const businesses = (await (await page.request.get("/api/businesses")).json()) as {
    id: string;
    code: string;
  }[];
  const approver = members.find((m) => m.email === approverEmail);
  const res = await page.request.post("/api/approvals", {
    data: {
      businessId: businesses.find((b) => b.code === "FM")?.id,
      formId: forms.find((f) => f.code === "GENERAL")?.id,
      title,
      body: { body: EMPTY_DOC },
      line: [
        { type: "approve", seq: 1, target: { kind: "user", membershipId: approver?.membershipId } },
      ],
      submit: true,
    },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { documentId: string }).documentId;
}

test("임시저장한 입력은 새로고침해도 이 브라우저에서 복구할 수 있다", async ({ page }) => {
  await loginAs(page, "박사원");
  await page.getByRole("link", { name: "새 결재" }).first().click();
  await page
    .getByRole("button", { name: /^일반 기안v1$/ })
    .first()
    .click();
  await page.getByRole("textbox", { name: "제목" }).fill("복구 확인 문서");
  await page.getByRole("button", { name: "작성 시작" }).click();
  await expect(page).toHaveURL(/\/approval\/draft\//);
  await expect(page.getByRole("heading", { level: 1, name: "일반 기안 작성" })).toBeVisible();
  await page.getByRole("textbox", { name: "내용" }).click();
  await page.keyboard.type("서버에 저장하기 전의 입력");
  // 로컬 사본은 1초 뒤 저장되고, 서버 자동 저장은 30초 뒤이다
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByText("저장하지 않은 입력이 있습니다")).toBeVisible();
  await page.getByRole("button", { name: "복구" }).click();
  await expect(page.getByText("서버에 저장하기 전의 입력")).toBeVisible();
});

test("360px 모바일에서 새 결재·기안함·결재 대기·문서 상세가 가로 스크롤 없이 보인다", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "모바일 전용");
  await loginAs(page, "박사원");
  for (const path of ["/approval/new", "/approval/mine", "/approval/pending"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, path).toBe(false);
  }
});

// 아래는 DB 상태를 바꾸므로 @stateful 태그를 달아 데스크톱 프로젝트에서만 한 번 실행한다 (playwright.config.ts)
test.describe("양식 기안 → 결재 → 완료 (S3 UI 흐름)", { tag: "@stateful" }, () => {
  test("박사원이 기안·상신하고, 최대리가 360px 모바일 화면에서 PIN 재인증 후 승인한다", async ({
    page,
  }) => {
    // 기안: 일반 기안은 기본 결재선이 기안자의 부서장(최대리)이다
    await loginAs(page, "박사원");
    await page.getByRole("link", { name: "새 결재" }).first().click();
    await page
      .getByRole("button", { name: /^일반 기안v1$/ })
      .first()
      .click();
    await page.getByRole("textbox", { name: "제목" }).fill("출장비 정산 안내");
    await page.getByRole("button", { name: "작성 시작" }).click();
    await expect(page).toHaveURL(/\/approval\/draft\//);
    await page.getByRole("textbox", { name: "내용" }).click();
    await page.keyboard.type("10월 출장비를 정산합니다.");
    await page.getByRole("button", { name: "임시저장" }).click();
    await expect(page.getByText(/저장됨/)).toBeVisible();

    // 첨부: 정상 PDF는 올라가고, PDF로 위장한 실행 파일은 거부된다
    await page.locator("#attachment-input").setInputFiles({
      name: "영수증.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"),
    });
    await expect(page.getByText("영수증.pdf을(를) 올렸습니다")).toBeVisible();
    await page.locator("#attachment-input").setInputFiles({
      name: "invoice.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 3, 0, 0, 0]),
    });
    await expect(page.getByText(/실행 파일은 올릴 수 없습니다/).first()).toBeVisible();

    await page.getByRole("button", { name: "상신", exact: true }).click();
    await expect(page).toHaveURL(/\/approval\/[0-9a-f-]{36}$/);
    await expect(page.getByText("진행 중").first()).toBeVisible();
    await expect(page.getByText("영수증.pdf", { exact: true })).toBeVisible();
    await signOut(page);

    // 결재: 최대리는 모바일 화면(360px)에서 본문·첨부를 확인하고 PIN 재인증 후 승인한다
    await loginAs(page, "최대리");
    // PIN은 설정만 하고 확인하지 않아, 처리할 때 재인증 대화상자가 떠야 한다
    const pinSet = await page.request.put("/api/me/pin", { data: { pin: "135790" } });
    const pin = pinSet.ok() ? "135790" : "482915";
    await page.setViewportSize({ width: 360, height: 780 });
    await page
      .getByRole("link", { name: /결재 대기/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/approval\/pending/);
    await page.getByRole("link", { name: /출장비 정산 안내/ }).click();
    await expect(page.getByText("10월 출장비를 정산합니다.")).toBeVisible();
    await expect(page.getByText("영수증.pdf", { exact: true })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);

    await page.getByRole("button", { name: "승인" }).click();
    await expect(page.getByRole("heading", { name: "결재 PIN 확인" })).toBeVisible();
    await page.getByRole("textbox", { name: "결재 PIN" }).fill(pin);
    await page.getByRole("button", { name: "확인하고 계속" }).click();
    await expect(page.getByText("처리했습니다")).toBeVisible();
    await expect(page.getByText("완료", { exact: true }).first()).toBeVisible();
    // 완료 문서에는 문서번호가 있고 처리 버튼이 사라진다
    await expect(page.getByText(/FM-GENERAL-\d{4}-\d{4}/)).toBeVisible();
    await expect(page.getByRole("button", { name: "승인" })).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("반려하면 기안자가 재기안 초안을 만들 수 있다 (S4)", async ({ page }) => {
    await loginAs(page, "박사원");
    const docId = await submitDoc(page, "반려 확인 문서", "hr@example.com");
    await signOut(page);

    await loginAs(page, "송인사");
    await verifyPin(page);
    await page.goto(`/approval/${docId}`);
    await page.getByRole("button", { name: "반려" }).click();
    // 사유 없이는 반려할 수 없다
    await page.getByRole("button", { name: "반려", exact: true }).last().click();
    await expect(page.getByRole("heading", { name: "반려 사유" })).toBeVisible();
    await page.getByLabel("사유·의견").fill("증빙을 보완해 주세요");
    await page.getByRole("button", { name: "반려", exact: true }).last().click();
    await expect(page.getByText("처리했습니다")).toBeVisible();
    await signOut(page);

    await loginAs(page, "박사원");
    await page.goto(`/approval/${docId}`);
    await expect(page.getByText("반려", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "재기안" }).click();
    await expect(page).toHaveURL(/\/approval\/draft\//);
    await expect(page.getByRole("textbox", { name: "제목" })).toHaveValue("반려 확인 문서");
  });

  test("처리 전에 회수하고 초안으로 되돌려 수정할 수 있다", async ({ page }) => {
    await loginAs(page, "박사원");
    const docId = await submitDoc(page, "회수 확인 문서", "hr@example.com");
    await page.goto(`/approval/${docId}`);
    await page.getByRole("button", { name: "회수" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "회수" }).click();
    await expect(page.getByText("회수했습니다")).toBeVisible();
    await page.getByRole("button", { name: "수정하기(초안으로)" }).click();
    await expect(page).toHaveURL(/\/approval\/draft\//);
    await expect(page.getByRole("textbox", { name: "제목" })).toHaveValue("회수 확인 문서");
  });

  test("의견을 남기고, 부재 설정을 등록·취소한다", async ({ page }) => {
    await loginAs(page, "박사원");
    const docId = await submitDoc(page, "의견 확인 문서", "hr@example.com");
    await page.goto(`/approval/${docId}`);
    await page.getByLabel("의견 추가").fill("검토 부탁드립니다");
    await page.getByRole("button", { name: "의견 등록" }).click();
    await expect(page.getByText("검토 부탁드립니다")).toBeVisible();

    await page.goto("/me/absence");
    await page.getByRole("combobox", { name: "대결자" }).click();
    await page.getByRole("option", { name: "송인사" }).click();
    await page.getByLabel("시작").fill("2030-01-01T09:00");
    await page.getByLabel("종료").fill("2030-01-03T18:00");
    await page.getByLabel("사유 (선택)").fill("연차");
    await page.getByRole("button", { name: "부재 설정", exact: true }).click();
    await expect(page.getByText("부재를 설정했습니다")).toBeVisible();
    await expect(page.getByRole("cell", { name: "송인사" })).toBeVisible();
    await page.getByRole("button", { name: "취소", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "취소하기" }).click();
    await expect(page.getByRole("cell", { name: "송인사" })).toHaveCount(0);
  });

  test("관리자가 양식을 만들고 새 버전으로 수정한다", async ({ page }) => {
    await loginAs(page, "이관리");
    await page.getByRole("button", { name: "사용자 메뉴" }).click();
    await page.getByRole("menuitem", { name: "관리 콘솔" }).click();
    await page
      .getByRole("navigation", { name: "관리 콘솔" })
      .getByRole("link", { name: "양식" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "양식 관리" })).toBeVisible();
    await expect(page.getByText("지출결의서")).toBeVisible();

    await page.getByRole("link", { name: "새 양식" }).click();
    await page.getByLabel("양식 이름").fill("회의록");
    await page.getByLabel(/^양식 코드/).fill("MINUTES");
    await page.getByRole("button", { name: "필드 추가" }).click();
    await expect(page.getByText("2. 텍스트")).toBeVisible();
    await page.getByRole("button", { name: "양식 만들기" }).click();
    await expect(page).toHaveURL(/\/admin\/forms\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: /회의록 편집/ })).toBeVisible();

    await page.getByLabel("양식 이름").fill("회의록(수정)");
    await page.getByRole("button", { name: "새 버전으로 저장" }).click();
    await expect(page.getByText(/새 버전\(v2\)으로 저장했습니다/)).toBeVisible();
  });
});

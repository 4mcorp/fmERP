import { expect, type Page, test } from "@playwright/test";

async function loginAs(page: Page, name: string) {
  // 시드 계정은 PIN이 없어 로그인 직후 PIN 설정 안내 모달이 뜨고 이후 클릭을 가로챈다 — 안내는 닫은 상태로 시작한다
  await page.addInitScript(() => window.sessionStorage.setItem("pin-setup-remind-dismissed", "1"));
  await page.goto("/dev-login");
  await page.getByRole("button", { name: `${name}(으)로 로그인` }).click();
  await expect(page).not.toHaveURL(/\/dev-login/);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "사용자 메뉴" }).click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login/);
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

async function createBlockForm(page: Page) {
  const response = await page.request.post("/api/forms", {
    data: {
      code: `BLOCK${Date.now().toString(36)}`,
      name: "블록 시험",
      category: "일반",
      version: {
        schema: { fields: [{ key: "subject", label: "항목", type: "text" }] },
        defaultLine: [],
        numbering: null,
        retentionYears: 3,
        securityDefault: "normal",
        allowLineEdit: true,
        policy: { disagree: "reject", rejectTo: "drafter", auditCanReject: false },
      },
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).formId as string;
}

test.describe("블록 편집기", { tag: "@stateful" }, () => {
  test("3.31.4 드래그 핸들 이동과 한글 조합 중 Enter 보호를 확인한다", async ({
    page,
    context,
  }) => {
    // 첫 진입의 개발 번들 컴파일을 포함한다. 요소별 기대 시간(15초)은 유지한다.
    test.setTimeout(60_000);
    await loginAs(page, "김대표");
    const id = await createBlockForm(page);
    await page.goto(`/admin/forms/${id}`);
    const editor = page.getByRole("textbox", { name: "양식 블록 편집기", exact: true });
    await expect(editor).toBeVisible();
    await page.getByLabel("추가할 블록").selectOption("text");
    await page.getByRole("button", { name: "블록 추가", exact: true }).click();
    await expect(editor.locator("[data-field-key]")).toHaveCount(2);
    await editor.locator('[data-field-key="subject"] .field').hover();
    const handle = page.getByRole("button", { name: "블록 드래그 이동", exact: true });
    await expect(handle).toBeVisible();
    await handle.dragTo(editor.locator(".node-paragraph").last());
    await expect
      .poll(async () =>
        editor
          .locator("[data-field-key]")
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-field-key"))),
      )
      .toEqual(["field1", "subject"]);
    await editor.locator(".node-paragraph").last().click();
    await page.keyboard.type("/");
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "쪽", selectionStart: 1, selectionEnd: 1 });
    await expect(page.getByRole("menuitem", { name: "쪽나눔", exact: true })).toBeVisible();
    await editor.dispatchEvent("keydown", { key: "Enter", isComposing: true, bubbles: true });
    await expect(editor.locator(".block-pagebreak")).toHaveCount(0);
    await cdp.send("Input.insertText", { text: "쪽" });
    await page.keyboard.press("Enter");
    await expect(editor.locator(".block-pagebreak")).toHaveCount(1);
    await expect(page.getByRole("status").filter({ hasText: "초안 저장 완료" })).toBeVisible();
    const draft = (await (await page.request.get(`/api/forms/${id}/draft`)).json()).draft;
    expect(draft.schema.fields.map((field: { key: string }) => field.key)).toEqual([
      "field1",
      "subject",
    ]);
    await cdp.detach();
  });
  test("슬래시·인라인 설정·초안 복구 후 명시적으로 새 버전을 저장한다", async ({ page }) => {
    await loginAs(page, "김대표");
    const id = await createBlockForm(page);
    await page.goto(`/admin/forms/${id}`);
    const editor = page.getByRole("textbox", { name: "양식 블록 편집기", exact: true });
    await expect(editor).toBeVisible();
    await expect(editor.locator(".node-paragraph").last()).toBeVisible();
    expect((await (await page.request.get(`/api/forms/${id}/draft`)).json()).draft).toBeNull();
    await editor.locator(".node-paragraph").last().click();
    await page.keyboard.type("/");
    await page.getByRole("menuitem", { name: "단일 선택", exact: true }).click();
    await editor.getByRole("button", { name: "항목 1 설정", exact: true }).click();
    const settings = editor.locator(".block-settings");
    await settings.getByLabel("라벨", { exact: true }).fill("출장 구분");
    await settings.getByLabel("도움말", { exact: true }).fill("해당 항목을 선택하세요");
    await settings.getByText("필수 항목", { exact: true }).check();
    await settings.getByLabel("선택지 1 라벨", { exact: true }).fill("국내");
    await expect(page.getByRole("status").filter({ hasText: "초안 저장 완료" })).toBeVisible();
    const draft = (await (await page.request.get(`/api/forms/${id}/draft`)).json()).draft;
    expect(draft.schema.fields).toEqual([
      { key: "subject", label: "항목", type: "text" },
      {
        key: "field1",
        label: "출장 구분",
        type: "select",
        help: "해당 항목을 선택하세요",
        required: true,
        options: [{ value: "a", label: "국내" }],
      },
    ]);
    expect((await (await page.request.get(`/api/forms/${id}`)).json()).version).toBe(1);
    await page.reload();
    await expect(editor.getByRole("button", { name: "출장 구분 설정", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "새 버전으로 저장", exact: true }).click();
    await expect(page.getByText(/새 버전\(v2\)으로 저장했습니다/)).toBeVisible();
    expect((await (await page.request.get(`/api/forms/${id}/draft`)).json()).draft.revision).toBe(
      draft.revision,
    );
    expect((await (await page.request.get(`/api/forms/${id}`)).json()).definition.schema).toEqual(
      draft.schema,
    );
    const code = (await (await page.request.get(`/api/forms/${id}`)).json()).code;
    await page.getByRole("button", { name: "목록", exact: true }).click();
    await page.getByPlaceholder("양식 이름·코드 검색").fill(code);
    await page.locator(`a[href="/admin/forms/${id}"]`).click();
    await editor.getByRole("button", { name: "출장 구분 설정", exact: true }).click();
    await editor
      .locator(".block-settings")
      .getByLabel("도움말", { exact: true })
      .fill("다시 연 초안");
    await expect(page.getByRole("status").filter({ hasText: "초안 저장 완료" })).toBeVisible();
    expect((await (await page.request.get(`/api/forms/${id}/draft`)).json()).draft.revision).toBe(
      draft.revision + 1,
    );
  });

  test("열 안 삽입·쪽나눔·라이트 고정과 360px 내부 스크롤을 보장한다", async ({ page }) => {
    await loginAs(page, "김대표");
    const id = await createBlockForm(page);
    await page.goto(`/admin/forms/${id}`);
    const editor = page.getByRole("textbox", { name: "양식 블록 편집기", exact: true });
    await expect(editor).toBeVisible();
    await editor.locator(".node-paragraph").last().click();
    await page.keyboard.type("/2");
    await page.getByRole("menuitem", { name: "2열", exact: true }).click();
    const columns = editor.locator(".node-formColumns");
    await expect(columns.locator(".node-formColumn")).toHaveCount(2);
    await columns.locator(".node-paragraph").first().click();
    await page.keyboard.type("/표");
    await page.getByRole("menuitem", { name: "표", exact: true }).click();
    await expect(columns.locator("[data-field-key]")).toHaveCount(1);
    await editor.locator(".node-paragraph").last().click();
    await page.keyboard.type("/쪽");
    await page.getByRole("menuitem", { name: "쪽나눔", exact: true }).click();
    await expect(editor.locator(".block-pagebreak")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "초안 저장 완료" })).toBeVisible();
    const saved = (await (await page.request.get(`/api/forms/${id}/draft`)).json()).draft;
    expect(saved.layout.blocks).toContainEqual({ kind: "pagebreak" });
    expect(
      saved.layout.blocks.find((b: { kind: string }) => b.kind === "columns").cols[0],
    ).toContainEqual({ kind: "field", key: "field1" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    expect(
      await page
        .locator(".form-editor-paper")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgb(255, 255, 255)");
    expect(
      await page
        .locator(".form-editor-chrome")
        .first()
        .evaluate((el) => (el as HTMLElement).isContentEditable),
    ).toBe(false);
    await page.setViewportSize({ width: 360, height: 780 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    expect(
      await columns
        .locator(".block-columns-scroll")
        .evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("block-editor-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator(".page-guide")).toHaveCount(1);
    const guideY = (await page.locator(".page-guide").boundingBox())?.y;
    const headerY = (await page.locator(".form-editor-chrome").first().boundingBox())?.y;
    expect(guideY).toBeDefined();
    expect(headerY).toBeDefined();
    expect(Math.abs((guideY ?? 0) - (headerY ?? 0) - (266 * 96) / 25.4)).toBeLessThan(1);
    await page.screenshot({
      path: test.info().outputPath("block-editor-desktop.png"),
      fullPage: true,
    });
    await page.reload();
    await columns.locator(".node-formColumn").last().locator(".node-paragraph").last().click();
    await page.keyboard.type("/날짜");
    await page.getByRole("menuitem", { name: "날짜", exact: true }).click();
    await expect(
      columns.locator(".node-formColumn").last().locator("[data-field-key]"),
    ).toHaveCount(1);
    await expect(page.getByRole("status").filter({ hasText: "초안 저장 완료" })).toBeVisible();
  });

  test("같은 초안의 탭 충돌은 내용을 보존하고 자동 덮어쓰기·공개를 막는다", async ({
    page,
    context,
  }) => {
    await loginAs(page, "김대표");
    const id = await createBlockForm(page);
    await page.goto(`/admin/forms/${id}`);
    await expect(
      page.getByRole("textbox", { name: "양식 블록 편집기", exact: true }),
    ).toBeVisible();
    const other = await context.newPage();
    await other.addInitScript(() => {
      try {
        sessionStorage.setItem("pin-setup-remind-dismissed", "1");
      } catch {}
    });
    await other.goto(`/admin/forms/${id}`);
    await expect(
      other.getByRole("textbox", { name: "양식 블록 편집기", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "항목 설정", exact: true }).click();
    await page.locator(".block-settings").getByLabel("라벨", { exact: true }).fill("먼저 저장");
    await expect(page.getByRole("status").filter({ hasText: "초안 저장 완료" })).toBeVisible();
    await other.getByRole("button", { name: "항목 설정", exact: true }).click();
    await other
      .locator(".block-settings")
      .getByLabel("라벨", { exact: true })
      .fill("충돌한 내 내용");
    await expect(
      other.getByRole("alert").filter({ hasText: "초안을 저장하지 못했습니다" }),
    ).toBeVisible();
    await expect(other.getByLabel("현재 초안 사본")).toContainText("충돌한 내 내용");
    await expect(
      other.getByRole("button", { name: "새 버전으로 저장", exact: true }),
    ).toBeDisabled();
    expect(
      (await (await page.request.get(`/api/forms/${id}/draft`)).json()).draft.schema.fields[0]
        .label,
    ).toBe("먼저 저장");
    await other.close();
  });
});

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
  // 양식은 분류 카드(일반) 안에 있고 기본으로 접혀 있다
  await expandCard(page, /^일반/);
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
    await expandCard(page, /^일반/);
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
    await expandCard(page, /^첨부/);
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
    await expandCard(page, /^첨부/);
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
    await expandCard(page, /^의견/);
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
    await page.getByPlaceholder("양식 이름·코드 검색").fill("지출결의서");
    await expect(page.getByText("지출결의서", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "새 양식" }).click();
    // 양식 코드는 계정 안에서 유일해야 한다. 이전 실행이 남긴 양식과 겹치지 않게 실행마다 다르게 쓴다
    const code = `MINUTES${Date.now().toString(36).toUpperCase()}`;
    // 실제 Tiptap 마운트는 hydration·권한 조회 뒤에 끝난다. HMR WebSocket이 유지되는 networkidle은 기다리지 않는다.
    await expect(
      page.getByRole("textbox", { name: "양식 블록 편집기", exact: true }),
    ).toBeVisible();
    await expect(async () => {
      await page.getByLabel("양식 이름").fill("회의록");
      await expect(page.getByLabel("양식 이름")).toHaveValue("회의록");
    }).toPass();
    await page.getByLabel(/^양식 코드/).fill(code);
    await page.getByText("기존 필드 목록 (블록 배치 후에는 참고용)", { exact: true }).click();
    await page.getByRole("button", { name: "필드 추가" }).click();
    await expect(page.getByText("2. 텍스트")).toBeVisible();
    await expect(page.getByLabel("양식 이름")).toHaveValue("회의록");
    await page.getByRole("button", { name: "양식 만들기" }).click();
    await expect(page).toHaveURL(/\/admin\/forms\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: /회의록 편집/ })).toBeVisible();

    await page.getByLabel("양식 이름").fill("회의록(수정)");
    await page.getByRole("button", { name: "새 버전으로 저장" }).click();
    await expect(page.getByText(/새 버전\(v2\)으로 저장했습니다/)).toBeVisible();
  });
});

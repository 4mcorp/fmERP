import { expect, type Locator, type Page, test } from "@playwright/test";

const PIN = "482915";
const NEW_EMAIL = "passkey.tester@example.com";
const NEW_NAME = "패스키테스터";
const RENAMED = "분실 대비 기기";

async function loginAs(page: Page, name: string) {
  // 시드 계정은 PIN이 없어 로그인 직후 PIN 설정 안내 모달이 뜨고 이후 클릭을 가로챈다 — 안내는 닫은 상태로 시작한다
  await page.addInitScript(() => window.sessionStorage.setItem("pin-setup-remind-dismissed", "1"));
  await page.goto("/dev-login");
  await page.getByRole("button", { name: `${name}(으)로 로그인` }).click();
  await expect(page).not.toHaveURL(/\/dev-login/);
}

async function signOut(page: Page) {
  const done = page.waitForResponse((r) => r.url().includes("/api/auth/sign-out"));
  await page.getByRole("button", { name: "사용자 메뉴" }).click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  const res = await done;
  expect(res.status(), "로그아웃 응답은 성공이어야 한다").toBeLessThan(300);
  await expect(page).toHaveURL(/\/login/);
  // 로그아웃 뒤 세션 쿠키가 남아 있으면 다음 사람(등록 링크 사용자)이 관리자 세션으로 들어간다
  const names = (await page.context().cookies()).map((c) => c.name);
  expect(names).not.toContain("fmerp.session_token");
}

/**
 * 가상 인증기(CDP WebAuthn). 사용자 확인 없이 자동 응답하고 검색 가능한 자격증명(discoverable)을 저장한다.
 * 자격증명은 브라우저 컨텍스트에 붙으므로 흐름 전체를 같은 페이지에서 이어 간다.
 */
const VIRTUAL_OPTIONS = {
  protocol: "ctap2",
  transport: "internal",
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
} as const;

async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: VIRTUAL_OPTIONS,
  });
  return { cdp, authenticatorId };
}

/** 재인증 PIN 창이 떴을 때만 PIN을 넣는다. 결과 확인은 호출하는 쪽의 expect가 맡는다 */
async function answerPinIfAsked(page: Page) {
  const pin = page.getByLabel("결재 PIN", { exact: true });
  const asked = await pin
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (!asked) return;
  await pin.fill(PIN);
  await page.getByRole("button", { name: "확인하고 계속" }).click();
}

function tokenLink(page: Page) {
  return page.locator("code").filter({ hasText: "/login?token=" });
}

/** Tab만 눌러 대상이 포커스를 받을 때까지 이동한다. 마우스 대신 키보드 도달 가능성을 확인한다 */
async function tabTo(page: Page, target: Locator, max = 200) {
  for (let i = 0; i < max; i += 1) {
    const focused = await target.evaluate((el) => el === document.activeElement);
    if (focused) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab ${max}번 안에 포커스가 대상에 도달하지 않았다`);
}

/** 재인증 PIN 창이 떴을 때 키보드만으로 PIN을 입력·확인한다 (Enter·Tab). 떠 있지 않으면 아무것도 하지 않는다 */
async function answerPinByKeyboardIfAsked(page: Page) {
  const pin = page.getByLabel("결재 PIN", { exact: true });
  const asked = await pin
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (!asked) return;
  await tabTo(page, pin);
  await page.keyboard.type(PIN);
  await tabTo(page, page.getByRole("button", { name: "확인하고 계속" }));
  await page.keyboard.press("Enter");
}

test("로그인 화면은 현재 뷰포트에서 가로 스크롤 없이 보인다 (360px·1280px)", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "패스키로 로그인" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  // Google 로그인은 PK2에서 문구·버튼을 모두 뺐다(플래그 없음). 어떤 뷰포트에서도 DOM에 없어야 한다
  await expect(page.getByText("Google")).toHaveCount(0);
  // 터치 대상은 44px 이상이어야 한다 (KWCAG 2.2 2.5.8 최소 24px, 여기서는 더 보수적으로 44px)
  const box = await page.getByRole("button", { name: "패스키로 로그인" }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("로그인 버튼은 키보드(Tab·Enter)로 도달·실행되고 포커스 표시가 보인다", async ({ page }) => {
  await addVirtualAuthenticator(page);
  await page.goto("/login");
  const button = page.getByRole("button", { name: "패스키로 로그인" });
  await expect(button).toBeVisible();
  // 포커스를 임의로 주지 않고 Tab만으로 도달해야 한다 (최대 10번)
  let reached = false;
  for (let i = 0; i < 10 && !reached; i += 1) {
    await page.keyboard.press("Tab");
    reached = await button.evaluate((el) => el === document.activeElement);
  }
  expect(reached, "Tab으로 로그인 버튼에 도달해야 한다").toBe(true);
  const focusStyle = await button.evaluate((el) => {
    const s = getComputedStyle(el);
    return { outline: s.outlineStyle, shadow: s.boxShadow };
  });
  expect(
    focusStyle.outline !== "none" || focusStyle.shadow !== "none",
    "포커스 표시가 있어야 한다",
  ).toBe(true);
  // 인증기 자격증명이 없으므로 실패 안내가 떠야 한다(사용자 열거 없는 일반 문구)
  await page.keyboard.press("Enter");
  await expect(page.getByText("패스키로 로그인하지 못했습니다", { exact: false })).toBeVisible();
});

// DB 상태를 바꾸므로 @stateful: 데스크톱 프로젝트에서 한 번 실행한다 (playwright.config.ts)
test.describe("패스키 흐름 (PK2)", { tag: "@stateful" }, () => {
  test("등록→로그아웃→로그인, 기기 추가·삭제, 관리자 초기화 후 재등록", async ({ page }) => {
    const { cdp, authenticatorId } = await addVirtualAuthenticator(page);

    // 1) 관리자가 결재 PIN을 설정하고 구성원을 사전 등록해 등록 링크를 받는다
    await loginAs(page, "이관리");
    await page.goto("/me");
    await page.getByRole("tab", { name: "결재 PIN" }).click();
    await page.getByLabel("새 PIN (숫자 6~12자리)").fill(PIN);
    await page.getByLabel("PIN 다시 입력").fill(PIN);
    await page.getByRole("button", { name: "설정" }).click();
    // 설정 토스트는 폼과 섹션에서 각각 한 번씩 떠 2건이 된다(strict mode 충돌) → 첫 건으로 본다
    await expect(page.getByText("PIN을 설정했습니다").first()).toBeVisible();

    await page.goto("/admin/members");
    await page.getByLabel("이메일", { exact: true }).fill(NEW_EMAIL);
    await page.getByLabel("이름", { exact: true }).fill(NEW_NAME);
    await page.getByRole("button", { name: "사전 등록" }).click();
    await answerPinIfAsked(page);
    await expect(tokenLink(page)).toBeVisible();
    const enrollUrl = (await tokenLink(page).textContent()) ?? "";
    expect(enrollUrl).toContain("/login?token=");
    await signOut(page);

    // 2) 등록 링크로 이 기기에 passkey를 만들면 등록과 함께 로그인된다
    await page.goto(enrollUrl);
    await tabTo(page, page.getByRole("button", { name: "이 기기에 패스키 만들기" }));
    await page.keyboard.press("Enter");
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { level: 1, name: "포엠테스트(주)" })).toBeVisible();

    // 3) 로그아웃 후 패스키로 로그인한다 (ID 입력 없음)
    await signOut(page);
    await page.goto("/login");
    await page.getByRole("button", { name: "패스키로 로그인" }).click();
    await expect(page).not.toHaveURL(/\/login/);

    // 4) 내 기기: 이 기기 추가 등록 → 두 개가 되고, 하나를 삭제하면 한 개로 준다
    // 한 인증기는 같은 사용자에게 자격증명을 두 개 만들지 않는다(excludeCredentials). Chrome은 내장(internal) 인증기를 하나만 허용하므로
    // 두 번째 기기는 USB 이동식 인증기로 만든다
    const second = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: { ...VIRTUAL_OPTIONS, transport: "usb" },
    });
    const secondAuthenticatorId = second.authenticatorId;
    await page.goto("/me");
    await page.getByRole("tab", { name: "내 기기" }).click();
    const list = page.getByRole("list", { name: "등록된 기기" });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    // 키보드(Tab·Enter)만으로 추가·삭제·이름 변경을 수행한다 (KWCAG 2.1.1)
    await tabTo(page, page.getByRole("button", { name: "이 기기 추가 등록" }));
    await page.keyboard.press("Enter");
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await tabTo(
      page,
      list.getByRole("listitem").first().getByRole("button", { name: /삭제$/ }),
      400,
    );
    await page.keyboard.press("Enter");
    const confirmDelete = page
      .getByRole("dialog")
      .getByRole("button", { name: "삭제", exact: true });
    await tabTo(page, confirmDelete, 400);
    await page.keyboard.press("Enter");
    await expect(list.getByRole("listitem")).toHaveCount(1);

    // 4-1) 남은 기기의 이름을 바꾸면 목록에 새 이름이 보이고, 새로고침 뒤에도 유지된다
    await tabTo(
      page,
      list
        .getByRole("listitem")
        .first()
        .getByRole("button", { name: /이름 변경$/ }),
      400,
    );
    await page.keyboard.press("Enter");
    const nameInput = page.getByLabel("기기 이름", { exact: true });
    await tabTo(page, nameInput, 400);
    await page.keyboard.press("Control+A");
    await page.keyboard.type(RENAMED);
    await tabTo(page, list.getByRole("button", { name: "저장", exact: true }), 400);
    await page.keyboard.press("Enter");
    await expect(list.getByText(RENAMED, { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("tab", { name: "내 기기" }).click();
    await expect(
      page.getByRole("list", { name: "등록된 기기" }).getByText(RENAMED, { exact: true }),
    ).toBeVisible();

    // 5) 관리자가 구성원의 passkey를 초기화해 재등록 링크를 받는다 (확인 대화상자 + PIN 재인증)
    await signOut(page);
    await loginAs(page, "이관리");
    await page.goto("/admin/members");
    await page.getByRole("button", { name: new RegExp(NEW_NAME) }).click();
    await tabTo(page, page.getByRole("button", { name: "passkey 초기화 (재등록 링크 발급)" }), 400);
    await page.keyboard.press("Enter");
    await tabTo(
      page,
      page.getByRole("dialog").getByRole("button", { name: "초기화", exact: true }),
      400,
    );
    await page.keyboard.press("Enter");
    await answerPinByKeyboardIfAsked(page);
    await expect(tokenLink(page)).toBeVisible();
    const reenrollUrl = (await tokenLink(page).textContent()) ?? "";
    expect(reenrollUrl).toContain("/login?token=");
    expect(reenrollUrl).not.toBe(enrollUrl);
    await signOut(page);

    // 6) 옛 자격증명을 지운 뒤 재등록 링크로 새 passkey를 만들고, 그것으로 로그인한다
    await cdp.send("WebAuthn.clearCredentials", { authenticatorId });
    await cdp.send("WebAuthn.clearCredentials", { authenticatorId: secondAuthenticatorId });
    await page.goto(reenrollUrl);
    await tabTo(page, page.getByRole("button", { name: "이 기기에 패스키 만들기" }));
    await page.keyboard.press("Enter");
    await expect(page).not.toHaveURL(/\/login/);
    await signOut(page);
    await page.goto("/login");
    await page.getByRole("button", { name: "패스키로 로그인" }).click();
    await expect(page).not.toHaveURL(/\/login/);
  });
});

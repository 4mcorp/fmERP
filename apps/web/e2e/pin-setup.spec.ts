import { expect, type Page, test } from "@playwright/test";

/**
 * 결재 PIN 안내·설정 E2E (AUTH-009, APV-043).
 *
 * 시나리오 1: PIN이 없는 사용자는 로그인 직후 PIN 설정 안내를 보고, 나중에를 누르면 안내가 닫힌다.
 * 시나리오 2: 승인자 PIN을 초기화한 뒤 결재 상세에서 PIN을 설정하고 승인한다.
 * 두 시나리오는 360px·1280px 뷰포트에서 실행하고 화면을 테스트 첨부로 남긴다.
 */

const VIEWPORTS = [
  { label: "360", width: 360, height: 780 },
  { label: "1280", width: 1280, height: 800 },
] as const;

/** 안내 모달을 띄우기 위해 dismissed 키를 넣지 않고 로그인한다 (시나리오 1 전용) */
async function loginWithReminder(page: Page, name: string) {
  await page.goto("/dev-login");
  await page.getByRole("button", { name: `${name}(으)로 로그인` }).click();
  await expect(page).not.toHaveURL(/\/dev-login/);
}

/** 로그인 후 응답된 /api/me의 profile.id로 현재 사용자의 userId를 확인한다. */
async function currentUserId(page: Page) {
  const response = await page.request.get("/api/me");
  expect(response.ok()).toBe(true);
  const me = (await response.json()) as { id?: string; profile?: { id?: string } };
  const id = me.profile?.id ?? me.id;
  expect(id).toBeTruthy();
  return id as string;
}

/** 관리자로 대상 구성원의 결재 PIN을 초기화한다. page.request는 현재 로그인 세션을 공유한다. */
async function resetMemberPin(page: Page, userId: string) {
  // 관리자 PIN 상태는 실행마다 다를 수 있으므로 GET /api/me의 hasPin으로 먼저 확인한다.
  // hasPin=false(PIN 미설정)이면 테스트용 PIN을 설정한 뒤 같은 값으로 재인증한다.
  const meResponse = await page.request.get("/api/me");
  expect(meResponse.ok(), "관리자 정보 조회").toBe(true);
  const me = (await meResponse.json()) as { hasPin: boolean };
  expect(typeof me.hasPin).toBe("boolean");
  const adminPin = "482915";
  if (!me.hasPin) {
    const set = await page.request.put("/api/me/pin", { data: { pin: adminPin } });
    expect(set.ok(), `관리자 PIN 설정: ${set.status()} ${await set.text()}`).toBe(true);
  }
  const verified = await page.request.post("/api/me/pin/verify", { data: { pin: adminPin } });
  expect(verified.ok(), `관리자 PIN 재인증: ${verified.status()} ${await verified.text()}`).toBe(
    true,
  );
  const response = await page.request.post(`/api/account/members/${userId}/pin/reset`);
  expect(
    response.ok(),
    `대상 구성원 PIN 초기화: ${response.status()} ${await response.text()}`,
  ).toBe(true);
}

async function signOut(page: Page) {
  // 결재 PIN 대화상자가 열려 있으면 메뉴를 가린다. 닫힐 때까지 기다린 뒤 로그아웃한다.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "사용자 메뉴" }).click();
  const logout = page.getByRole("menuitem", { name: "로그아웃" });
  if (!(await logout.isVisible())) {
    // 360px에서 메뉴가 닫혀 있으면 한 번 더 열어 보이게 한다
    await page.getByRole("button", { name: "사용자 메뉴" }).click();
  }
  await logout.click();
  await expect(page).toHaveURL(/\/login/);
}

test.describe("결재 PIN 안내·설정", () => {
  for (const vp of VIEWPORTS) {
    test(`시나리오 1 [${vp.label}px] PIN 미설정 사용자는 로그인 후 안내를 보고, 나중에 누르면 돌아간다`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await loginWithReminder(page, "감사인");

      const dialog = page.getByRole("dialog", { name: "결재 PIN을 설정해 주세요" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("새 PIN (숫자 6~12자리)")).toBeVisible();
      await expect(dialog.getByLabel("PIN 다시 입력")).toBeVisible();
      await testInfo.attach(`pin-remind-${vp.label}`, {
        body: await page.screenshot({ fullPage: false }),
        contentType: "image/png",
      });

      // "나중에" = 취소: 안내가 닫히고, 이 탭 세션에서는 다시 뜨지 않는다
      await dialog.getByRole("button", { name: "취소" }).click();
      await expect(dialog).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("dialog", { name: "결재 PIN을 설정해 주세요" })).toHaveCount(0);
    });
  }

  for (const vp of VIEWPORTS) {
    test(`재로그인 [${vp.label}px] 같은 탭에서 같은 사용자와 다른 사용자에게 다시 안내한다`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const dialog = page.getByRole("dialog", { name: "결재 PIN을 설정해 주세요" });
      await loginWithReminder(page, "감사인");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "취소" }).click();
      await page.reload();
      await expect(page.getByRole("button", { name: "사용자 메뉴" })).toBeVisible();
      await expect(dialog).toHaveCount(0);

      for (const name of ["감사인", "한겸직"]) {
        await signOut(page);
        await loginWithReminder(page, name);
        await expect(dialog).toBeVisible();
        await testInfo.attach(`pin-relogin-${name}-${vp.label}`, {
          body: await page.screenshot({ fullPage: false }),
          contentType: "image/png",
        });
        await dialog.getByRole("button", { name: "취소" }).click();
        await expect(dialog).toHaveCount(0);
      }
    });
  }

  test.describe("시나리오 2 결재 상세에서 PIN을 설정하고 승인", { tag: "@stateful" }, () => {
    for (const vp of VIEWPORTS) {
      test(`[${vp.label}px] 승인자가 인라인 PIN 설정 후 승인한다`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.addInitScript(() =>
          window.sessionStorage.setItem("pin-setup-remind-dismissed", "1"),
        );

        // 최대리로 대상 승인자를 특정한다. 이후 관리자로 로그인해 API가 요구하는 재인증을 수행한다.
        await page.goto("/dev-login");
        await page.getByRole("button", { name: "최대리(으)로 로그인" }).click();
        await expect(page).not.toHaveURL(/\/dev-login/);
        const approverUserId = await currentUserId(page);
        await signOut(page);

        // 이관리 PIN은 격리 DB의 첫 호출에서 설정하며, 이후 호출과 다음 뷰포트도 같은 값을 검증한다.
        await page.goto("/dev-login");
        await page.getByRole("button", { name: "이관리(으)로 로그인" }).click();
        await expect(page).not.toHaveURL(/\/dev-login/);
        const adminUserId = await currentUserId(page);
        expect(adminUserId).not.toBe(approverUserId);
        await resetMemberPin(page, approverUserId);
        await signOut(page);

        // 기안자는 승인 PIN을 설정하지 않고 API로 결재 문서를 만들며, 최대리를 단일 승인자로 지정한다.
        await page.goto("/dev-login");
        await page.getByRole("button", { name: "박사원(으)로 로그인" }).click();
        await expect(page).not.toHaveURL(/\/dev-login/);
        const forms = (await (await page.request.get("/api/forms")).json()) as {
          id: string;
          code: string;
        }[];
        const members = (await (await page.request.get("/api/account/members")).json()) as {
          userId: string;
          email: string;
          membershipId: string;
        }[];
        const businesses = (await (await page.request.get("/api/businesses")).json()) as {
          id: string;
          code: string;
        }[];
        const approver = members.find((member) => member.email === "member2@example.com");
        expect(approver?.userId, "결재선과 PIN 초기화 대상은 같은 최대리 userId").toBe(
          approverUserId,
        );
        expect(approver?.membershipId).toBeTruthy();
        const created = await page.request.post("/api/approvals", {
          data: {
            businessId: businesses.find((business) => business.code === "FM")?.id,
            formId: forms.find((form) => form.code === "GENERAL")?.id,
            title: `인라인 PIN 승인 ${vp.label}px ${Date.now()}`,
            body: { body: { type: "doc", content: [] } },
            line: [
              {
                type: "approve",
                seq: 1,
                target: { kind: "user", membershipId: approver?.membershipId },
              },
            ],
            submit: true,
          },
        });
        expect(created.ok(), "승인 문서 생성").toBe(true);
        const documentId = ((await created.json()) as { documentId: string }).documentId;
        await signOut(page);

        // 관리자 API로 최대리 PIN을 다시 초기화해 실제 승인 흐름에서 PIN 미설정 상태를 만든다.
        await page.goto("/dev-login");
        await page.getByRole("button", { name: "이관리(으)로 로그인" }).click();
        await expect(page).not.toHaveURL(/\/dev-login/);
        await resetMemberPin(page, approverUserId);
        await signOut(page);

        await page.goto("/dev-login");
        await page.getByRole("button", { name: "최대리(으)로 로그인" }).click();
        await expect(page).not.toHaveURL(/\/dev-login/);
        expect(await currentUserId(page), "승인 로그인과 PIN 초기화 대상 일치").toBe(
          approverUserId,
        );
        await page.goto(`/approval/${documentId}`);
        await expect(page.getByRole("button", { name: "승인" })).toBeVisible();
        await page.getByRole("button", { name: "승인" }).click();

        const pinDialog = page.getByRole("dialog");
        await expect(pinDialog).toBeVisible();
        await expect(pinDialog.getByLabel("새 PIN (숫자 6~12자리)")).toBeVisible();
        await pinDialog.getByLabel("새 PIN (숫자 6~12자리)").fill("482915");
        await pinDialog.getByLabel("PIN 다시 입력").fill("482915");
        await testInfo.attach(`pin-inline-setup-${vp.label}`, {
          body: await page.screenshot({ fullPage: false }),
          contentType: "image/png",
        });
        await pinDialog.getByRole("button", { name: "설정하고 계속" }).click();
        await expect(pinDialog.getByRole("heading", { name: "결재 PIN 확인" })).toBeVisible();
        await pinDialog.getByLabel("결재 PIN").fill("482915");
        await pinDialog.getByRole("button", { name: "확인하고 계속" }).click();
        await expect(page.getByText("처리했습니다")).toBeVisible();
        await expect(page.getByText("완료", { exact: true }).first()).toBeVisible();
        // 승인 후 PIN 대화상자가 닫혔는지 확인해야 다음 단계(로그아웃)가 메뉴를 가리지 않는다
        await expect(page.getByRole("dialog")).toHaveCount(0);
      });
    }
  });
});

/*
 * 검증 상태 메모
 * - 시나리오 2는 관리자 API로 대상 PIN을 초기화한다. 테스트 종료 시 최대리 PIN은 482915이며,
 *   M4 verifyPin의 기존 PIN 후보([482915, 135790]) 및 최대리 승인 단계의 기존 PIN 분기(482915)와 맞춘다.
 * - /api/me는 로그인 사용자의 profile.id를 반환하므로 userId는 로그인한 세션에서 동적으로 읽는다.
 * - 이 파일은 k3s 격리 pod에서만 실행한다(호스트에서 서버·DB를 띄우지 않는다).
 */

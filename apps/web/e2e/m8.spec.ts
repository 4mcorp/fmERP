import { expect, type Page, test } from "@playwright/test";

async function loginAs(page: Page, name: string) {
  // 시드 계정은 PIN이 없어 로그인 직후 PIN 설정 안내 모달이 뜨고 이후 클릭을 가로챈다 — 안내는 닫은 상태로 시작한다
  await page.addInitScript(() => window.sessionStorage.setItem("pin-setup-remind-dismissed", "1"));
  await page.goto("/dev-login");
  await page.getByRole("button", { name: `${name}(으)로 로그인` }).click();
  await expect(page).not.toHaveURL(/\/dev-login/);
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

// E2E 환경에는 worker와 텔레그램 봇이 없다. 알림 생성·발송은 통합 테스트(가짜 Bot API)가 확인한다.
test.describe("알림 (M8)", () => {
  test("알림 센터와 내 정보의 텔레그램 안내가 열린다", async ({ page }) => {
    await loginAs(page, "박사원");
    await page.getByRole("link", { name: /^알림/ }).click();
    await expect(page).toHaveURL(/\/notifications/);
    await expect(page.getByRole("heading", { level: 1, name: "알림" })).toBeVisible();
    await expect(page.getByRole("button", { name: "모두 읽음" })).toBeVisible();
    await page.getByRole("button", { name: "안 읽은 알림만" }).click();
    await expect(page.getByRole("button", { name: "안 읽은 알림만" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.goto("/me");
    await page.getByRole("tab", { name: "알림" }).click();
    await expect(page.getByText("텔레그램 알림").first()).toBeVisible();
    // 봇이 설정되지 않은 서버에서는 연결 버튼 대신 안내가 보인다
    await expect(
      page.getByText("이 서버에는 텔레그램 알림이 설정되어 있지 않습니다"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "텔레그램 연결" })).toHaveCount(0);
  });

  test("텔레그램 수신 방식 화면은 시스템 관리자만 열 수 있고, 웹훅은 조건이 안 되면 막힌다", async ({
    page,
  }) => {
    await loginAs(page, "이관리");
    await page.goto("/system/telegram");
    await expect(page.getByText("시스템 관리자만 열 수 있는 화면입니다")).toBeVisible();

    await loginAs(page, "김대표");
    await page.getByRole("button", { name: "사용자 메뉴" }).click();
    await page.getByRole("menuitem", { name: "텔레그램 수신 방식" }).click();
    await expect(page).toHaveURL(/\/system\/telegram/);
    await expect(page.getByRole("heading", { level: 1, name: "텔레그램 수신 방식" })).toBeVisible();
    await expect(page.getByText("현재 설정: 폴링")).toBeVisible();
    await expect(page.getByText("텔레그램 봇이 설정되지 않았습니다")).toBeVisible();
    await expect(page.getByRole("button", { name: "웹훅으로 전환" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "사용 중" })).toBeDisabled();
  });

  test("360px 모바일에서도 알림 화면이 가로로 넘치지 않는다", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await loginAs(page, "박사원");
    await page.goto("/");
    await expect(page.getByRole("region", { name: "결재 대기" })).toBeVisible();
    await expectNoPageOverflow(page);
    await page.goto("/notifications");
    await expect(page.getByRole("heading", { level: 1, name: "알림" })).toBeVisible();
    await expectNoPageOverflow(page);
    await page.goto("/me");
    await page.getByRole("tab", { name: "알림" }).click();
    await expectNoPageOverflow(page);
  });
});

const EMPTY_DOC = { type: "doc", content: [] };

async function verifyPin(page: Page) {
  const set = await page.request.put("/api/me/pin", { data: { pin: "135790" } });
  const candidates = set.ok() ? ["135790"] : ["482915", "135790", "246810"];
  for (const pin of candidates) {
    if ((await page.request.post("/api/me/pin/verify", { data: { pin } })).ok()) return;
  }
  throw new Error("PIN을 확인하지 못했습니다");
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "사용자 메뉴" }).click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login/);
}

// 홈 대시보드 (DSH-001): 기안·상신·승인하며 결재 대기 → 진행 중 → 최근 완료로 옮겨 가는지 본다
test.describe("홈 대시보드 (M8)", () => {
  test("결재 대기·진행 중·최근 완료와 자주 쓰는 양식이 홈에 보인다 @stateful", async ({ page }) => {
    const title = `홈 대시보드 시험 ${Date.now()}`;

    await loginAs(page, "박사원");
    const get = async <T>(url: string) => (await (await page.request.get(url)).json()) as T;
    const forms = await get<{ id: string; code: string; name: string }[]>("/api/forms");
    const members = await get<{ email: string; membershipId: string }[]>("/api/account/members");
    const businesses = await get<{ id: string; code: string }[]>("/api/businesses");
    const general = forms.find((f) => f.code === "GENERAL");
    const approver = members.find((m) => m.email === "member2@example.com");
    const created = await page.request.post("/api/approvals", {
      data: {
        businessId: businesses.find((b) => b.code === "FM")?.id,
        formId: general?.id,
        title,
        body: { body: EMPTY_DOC },
        line: [
          {
            type: "approve",
            seq: 1,
            target: { kind: "user", membershipId: approver?.membershipId },
          },
        ],
      },
    });
    expect(created.ok()).toBe(true);
    const { documentId } = (await created.json()) as { documentId: string };
    expect(
      (await page.request.post(`/api/approvals/${documentId}/submit`, { data: {} })).ok(),
    ).toBe(true);
    // 즐겨찾기한 양식이 바로가기에 나온다
    expect(
      (
        await page.request.put(`/api/forms/${general?.id}/favorite`, { data: { favorite: true } })
      ).ok(),
    ).toBe(true);

    await page.goto("/");
    const inProgress = page.getByRole("region", { name: "내가 올린 진행 중 문서" });
    await expect(inProgress.getByRole("link", { name: new RegExp(title) })).toBeVisible();

    // 바로가기를 누르면 그 양식이 선택된 새 결재 화면이 열린다
    await page
      .getByRole("link", { name: new RegExp(`${general?.name}`) })
      .first()
      .click();
    await expect(page).toHaveURL(/\/approval\/new\?form=/);
    await expect(
      page.getByRole("button", { name: new RegExp(`^${general?.name}`) }).first(),
    ).toHaveAttribute("aria-pressed", "true");
    await signOut(page);

    // 결재자의 홈: 결재 대기에 보이고, 승인하면 기안자의 최근 완료로 옮겨 간다
    await loginAs(page, "최대리");
    await page.goto("/");
    // 홈에는 오래 기다린 순으로 5건만 보이므로(다른 시험이 남긴 결재 대기가 있을 수 있다) 목록과 건수는 따로 확인한다
    const pendingRegion = page.getByRole("region", { name: "결재 대기" });
    await expect(pendingRegion.getByRole("link").first()).toBeVisible();
    // 상단 메뉴의 배지와 홈의 요약 카드 둘 다 같은 건수를 보인다
    await expect(page.getByRole("link", { name: /^결재 대기\s*[1-9]\d*\s*건/ })).toHaveCount(2);
    await page.goto("/approval/pending");
    await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
    await verifyPin(page);
    const view = (await (await page.request.get(`/api/approvals/${documentId}`)).json()) as {
      steps: { id: string; status: string; version: number }[];
    };
    const step = view.steps.find((s) => s.status === "ACTIVE");
    const act = await page.request.post(`/api/approvals/${documentId}/steps/${step?.id}/act`, {
      data: {
        action: { kind: "approve" },
        idempotencyKey: crypto.randomUUID(),
        expectedVersion: step?.version,
      },
    });
    expect(act.ok()).toBe(true);
    await page.goto("/approval/pending");
    await expect(page.getByRole("heading", { level: 1, name: "결재 대기" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(title) })).toHaveCount(0);
    await signOut(page);

    await loginAs(page, "박사원");
    await page.goto("/");
    const done = page.getByRole("region", { name: "최근 완료 문서" });
    await expect(done.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  });
});

// S5. 대결: 결재자가 부재 중이면 대결자에게 결재 차례가 가고, 승인하면 결재란에 "대결 OOO"로 보인다
test.describe("대결 (S5)", () => {
  test("부재 중인 결재자의 문서를 대결자가 승인하면 결재란에 대결로 표시된다 @stateful", async ({
    page,
  }) => {
    const title = `대결 시험 ${Date.now()}`;
    const get = async <T>(url: string) => (await (await page.request.get(url)).json()) as T;

    // 최대리가 지금부터 하루 동안 부재이고 송인사를 대결자로 지정한다
    await loginAs(page, "최대리");
    const members = await get<{ email: string; membershipId: string }[]>("/api/account/members");
    const absent = members.find((m) => m.email === "member2@example.com");
    const delegate = members.find((m) => m.email === "hr@example.com");
    const now = Date.now();
    const made = await page.request.post("/api/delegations", {
      data: {
        delegateMembershipId: delegate?.membershipId,
        from: new Date(now - 3_600_000).toISOString(),
        to: new Date(now + 24 * 3_600_000).toISOString(),
        scope: { kind: "all" },
        reason: "S5 시험",
      },
    });
    expect(made.ok()).toBe(true);
    const { id: delegationId } = (await made.json()) as { id: string };

    try {
      await signOut(page);
      await loginAs(page, "박사원");
      const forms = await get<{ id: string; code: string }[]>("/api/forms");
      const businesses = await get<{ id: string; code: string }[]>("/api/businesses");
      const created = await page.request.post("/api/approvals", {
        data: {
          businessId: businesses.find((b) => b.code === "FM")?.id,
          formId: forms.find((f) => f.code === "GENERAL")?.id,
          title,
          body: { body: EMPTY_DOC },
          line: [
            {
              type: "approve",
              seq: 1,
              target: { kind: "user", membershipId: absent?.membershipId },
            },
          ],
        },
      });
      expect(created.ok()).toBe(true);
      const { documentId } = (await created.json()) as { documentId: string };
      expect(
        (await page.request.post(`/api/approvals/${documentId}/submit`, { data: {} })).ok(),
      ).toBe(true);
      await signOut(page);

      // 대결자의 결재 대기에 "대결"로 보이고, 승인하면 문서가 완료된다
      await loginAs(page, "송인사");
      await page.goto("/approval/pending");
      const row = page.getByRole("link", { name: new RegExp(title) });
      await expect(row).toBeVisible();
      // "대결" 배지는 제목 링크 밖(같은 행)에 있으므로 행 단위로 찾는다
      await expect(
        page
          .getByRole("row")
          .filter({ has: page.getByRole("link", { name: new RegExp(title) }) })
          .getByText("대결", { exact: true }),
      ).toBeVisible();
      await verifyPin(page);
      const view = await get<{ steps: { id: string; status: string; version: number }[] }>(
        `/api/approvals/${documentId}`,
      );
      const step = view.steps.find((s) => s.status === "ACTIVE");
      const act = await page.request.post(`/api/approvals/${documentId}/steps/${step?.id}/act`, {
        data: {
          action: { kind: "approve" },
          idempotencyKey: crypto.randomUUID(),
          expectedVersion: step?.version,
        },
      });
      expect(act.ok()).toBe(true);

      await page.goto(`/approval/${documentId}`);
      await expect(page.getByText("대결 송인사")).toBeVisible();
      await signOut(page);
    } finally {
      // 다른 시험에 영향이 없도록 부재 설정을 반드시 취소한다
      await loginAs(page, "최대리");
      await page.request.delete(`/api/delegations/${delegationId}`);
    }
  });
});

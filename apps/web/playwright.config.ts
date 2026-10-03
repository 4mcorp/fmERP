import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT, e2eEnv } from "./e2e/test-env";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // 테스트 DB 하나를 공유하므로 순서대로 실행한다
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // 개발 서버는 페이지를 처음 열 때 컴파일하므로 기본(5초)보다 길게 기다린다
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // 결재 처리는 360px 모바일에서도 가능해야 한다 (PRD APV-048, NFR-U02)
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 360, height: 780 } },
      // DB 상태를 바꾸는 흐름은 데스크톱에서 한 번만 실행한다
      grepInvert: /@stateful/,
    },
  ],
  webServer: {
    command: `npx next dev --port ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}/api/health`,
    // 개발 서버(테스트 DB가 아닌 서버)를 실수로 재사용하지 않는다
    reuseExistingServer: false,
    env: e2eEnv,
    timeout: 120_000,
  },
});

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("../", import.meta.url));

function readConfig(mode?: string) {
  const env = { ...process.env };
  delete env.E2E_SERVER_MODE;
  if (mode !== undefined) env.E2E_SERVER_MODE = mode;
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      'import config from "./playwright.config.ts"; console.log(JSON.stringify(config));',
    ],
    { cwd: webRoot, env, encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

describe("E2E 서버 모드 공개 설정", () => {
  it("기본은 dev이고 production은 빌드와 시작에 격리 staging 환경을 적용한다", () => {
    const dev = readConfig();
    expect(dev.webServer.command).toBe("npx next dev --port 3100");
    expect(dev.webServer.timeout).toBe(120_000);
    const production = readConfig("production");
    expect(production.webServer.command).toBe("npx next build && npx next start --port 3100");
    expect(production.webServer.env).toMatchObject({
      NODE_ENV: "production",
      APP_ENV: "staging",
      DEV_TEST_LOGIN: "true",
      BETTER_AUTH_URL: "http://localhost:3100",
    });
    const db = new URL(production.webServer.env.DATABASE_URL);
    expect([db.username, db.hostname, db.port, db.pathname]).toEqual([
      "fmerp_app",
      "localhost",
      "55433",
      "/fmerp",
    ]);
    expect(production.webServer.reuseExistingServer).toBe(false);
    expect(production.webServer.url).toBe("http://localhost:3100/api/health");
    expect(production.webServer.timeout).toBe(600_000);
    expect(production.use.baseURL).toBe("http://localhost:3100");
    expect(production.expect.timeout).toBe(15_000);
    expect(production.use.trace).toBe("retain-on-failure");
    expect(production.reporter).toContainEqual([
      "json",
      { outputFile: "playwright-report/results.json" },
    ]);
  });
  it("알 수 없는 모드는 Playwright CLI에서 테스트 실행 전에 거부한다", () => {
    const result = spawnSync(
      process.execPath,
      ["node_modules/@playwright/test/cli.js", "test", "--list"],
      {
        cwd: webRoot,
        env: { ...process.env, E2E_SERVER_MODE: "prodution" },
        encoding: "utf8",
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("E2E_SERVER_MODE");
    expect(result.stderr).toContain("prodution");
  });
});

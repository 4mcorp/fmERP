// 테스트 대상(포트·DB 이름·E2E 포트·S3 endpoint)을 환경변수로 바꿀 때 모든 소비처가 같은 값을 쓰는지 확인한다.
// 공유 테스트 DB에는 접속하지 않는다. 가드는 연결 전에 거부한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertTestDatabaseUrl,
  readTestDbTarget,
  resetTestDatabase,
} from "../../../packages/db/test/reset-test-db";

const KEYS = ["TEST_DB_PORT", "TEST_DB_NAME", "TEST_E2E_PORT", "TEST_S3_ENDPOINT"] as const;
const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

function setEnv(vars: Partial<Record<(typeof KEYS)[number], string>>): void {
  for (const key of KEYS) {
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
  }
  setEnv({});
  vi.resetModules();
});

afterEach(() => {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

async function loadE2e() {
  return await import("../../../apps/web/e2e/test-env");
}

async function loadPlaywright() {
  return (await import("../../../apps/web/playwright.config")).default;
}

async function loadVitest() {
  return await import("../../../vitest.config");
}

describe("테스트 대상 기본값 (환경변수 미지정)", () => {
  it("기존 값(55433/fmerp, E2E 3100, S3 58333, 앱 localhost:3000)과 같다", async () => {
    const e2e = await loadE2e();
    expect(e2e.E2E_PORT).toBe(3100);
    expect(e2e.e2eEnv.DATABASE_URL).toBe(
      "postgres://fmerp_app:fmerp_app_dev@localhost:55433/fmerp",
    );
    expect(e2e.e2eEnv.MIGRATION_DATABASE_URL).toContain("@localhost:55433/fmerp");
    expect(e2e.e2eEnv.AUTH_DATABASE_URL).toContain("@localhost:55433/fmerp");
    expect(e2e.e2eEnv.S3_ENDPOINT).toBe("http://localhost:58333");
    expect(e2e.e2eEnv.BETTER_AUTH_URL).toBe("http://localhost:3100");

    const vitest = await loadVitest();
    expect(vitest.integrationEnv.DATABASE_URL).toContain("@localhost:55433/fmerp");
    expect(vitest.integrationEnv.MIGRATION_DATABASE_URL).toContain("@localhost:55433/fmerp");
    expect(vitest.integrationEnv.S3_ENDPOINT).toBe("http://localhost:58333");
    expect(vitest.integrationEnv.BETTER_AUTH_URL).toBe("http://localhost:3000");

    expect(readTestDbTarget({})).toEqual({ port: 55433, name: "fmerp" });
  });

  it("Playwright baseURL과 webServer도 3100을 쓴다", async () => {
    const config = await loadPlaywright();
    expect(config.use?.baseURL).toBe("http://localhost:3100");
    expect(config.webServer).toMatchObject({
      command: "npx next dev --port 3100",
      url: "http://localhost:3100/api/health",
    });
  });
});

describe("테스트 대상 지정 (환경변수 설정)", () => {
  const override = {
    TEST_DB_PORT: "55544",
    TEST_DB_NAME: "fmerp_test_b2",
    TEST_E2E_PORT: "3200",
    TEST_S3_ENDPOINT: "http://localhost:58444",
  };
  const dbSuffix = "@localhost:55544/fmerp_test_b2";

  it("같은 값이 E2E 서버 env, reset 대상, Playwright, Vitest env에 모두 쓰인다", async () => {
    setEnv(override);
    const e2e = await loadE2e();

    expect(e2e.E2E_PORT).toBe(3200);
    expect(e2e.e2eEnv.DATABASE_URL).toContain(dbSuffix);
    expect(e2e.e2eEnv.AUTH_DATABASE_URL).toContain(dbSuffix);
    expect(e2e.e2eEnv.MIGRATION_DATABASE_URL).toContain(dbSuffix);
    expect(e2e.e2eEnv.BETTER_AUTH_URL).toBe("http://localhost:3200");
    expect(e2e.e2eEnv.S3_ENDPOINT).toBe("http://localhost:58444");

    const config = await loadPlaywright();
    expect(config.use?.baseURL).toBe("http://localhost:3200");
    expect(config.webServer).toMatchObject({
      command: "npx next dev --port 3200",
      url: "http://localhost:3200/api/health",
      env: e2e.e2eEnv,
    });

    const vitest = await loadVitest();
    expect(vitest.integrationEnv.DATABASE_URL).toContain(dbSuffix);
    expect(vitest.integrationEnv.AUTH_DATABASE_URL).toContain(dbSuffix);
    expect(vitest.integrationEnv.MIGRATION_DATABASE_URL).toContain(dbSuffix);
    expect(vitest.integrationEnv.BACKUP_DATABASE_URL).toContain(dbSuffix);
    expect(vitest.integrationEnv.S3_ENDPOINT).toBe("http://localhost:58444");

    // globalSetup의 reset은 같은 env에서 만든 MIGRATION URL을 허용해야 한다
    const target = readTestDbTarget();
    expect(() => assertTestDatabaseUrl(e2e.e2eEnv.MIGRATION_DATABASE_URL, target)).not.toThrow();
    expect(() =>
      assertTestDatabaseUrl(vitest.integrationEnv.MIGRATION_DATABASE_URL, target),
    ).not.toThrow();
  });

  it("허용 목록 밖의 DB 이름과 포트는 거부한다", () => {
    const target = { port: 55544, name: "fmerp_test_b2" };
    expect(() => assertTestDatabaseUrl("postgres://u:pw@localhost:55544/fmerp", target)).toThrow(
      "초기화하지 않습니다",
    );
    expect(() =>
      assertTestDatabaseUrl("postgres://u:pw@localhost:55433/fmerp_test_b2", target),
    ).toThrow("초기화하지 않습니다");
    expect(() =>
      assertTestDatabaseUrl("postgres://u:pw@db.example.com:55544/fmerp_test_b2", target),
    ).toThrow("초기화하지 않습니다");
  });

  it("허용 목록 밖의 이름과 개발 포트 대상은 env에서도 거부한다", () => {
    expect(() => readTestDbTarget({ TEST_DB_NAME: "other_db", TEST_DB_PORT: "55544" })).toThrow(
      "허용되지 않은 테스트 DB 이름",
    );
    expect(() => readTestDbTarget({ TEST_DB_PORT: "55432", TEST_DB_NAME: "fmerp_test" })).toThrow(
      "개발 DB 포트",
    );
    expect(() => readTestDbTarget({ TEST_DB_PORT: "abc" })).toThrow("포트가 올바르지");
  });

  it("허용 포트 목록에 없는 포트는 이름이 맞아도 env와 URL 가드에서 거부한다", () => {
    // 5432(기본 PostgreSQL)와 55500(목록 밖 격리 후보)은 거부되어야 한다
    expect(() => readTestDbTarget({ TEST_DB_PORT: "5432", TEST_DB_NAME: "fmerp" })).toThrow(
      "허용되지 않은 테스트 DB 포트",
    );
    expect(() =>
      readTestDbTarget({ TEST_DB_PORT: "55500", TEST_DB_NAME: "fmerp_test_b2" }),
    ).toThrow("허용되지 않은 테스트 DB 포트");
    // 목록에 있는 격리 포트(55544)는 같은 이름으로 허용된다
    expect(readTestDbTarget({ TEST_DB_PORT: "55544", TEST_DB_NAME: "fmerp_test_b2" })).toEqual({
      port: 55544,
      name: "fmerp_test_b2",
    });
    expect(() =>
      assertTestDatabaseUrl("postgres://u:***@localhost:5432/fmerp_test_b2", {
        port: 5432,
        name: "fmerp_test_b2",
      }),
    ).toThrow("허용되지 않은 테스트 DB 포트");
    expect(() =>
      assertTestDatabaseUrl("postgres://u:***@localhost:55500/fmerp_test_b2", {
        port: 55500,
        name: "fmerp_test_b2",
      }),
    ).toThrow("허용되지 않은 테스트 DB 포트");
    expect(() =>
      assertTestDatabaseUrl("postgres://u:***@localhost:55544/fmerp_test_b2", {
        port: 55544,
        name: "fmerp_test_b2",
      }),
    ).not.toThrow();
  });

  it("개발 DB URL로 reset하면 연결 전에 거부한다", async () => {
    await expect(
      resetTestDatabase("postgres://fmerp_migrator:pw@localhost:55432/fmerp"),
    ).rejects.toThrow("초기화하지 않습니다");
  });
});

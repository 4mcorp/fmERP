import { describe, expect, it } from "vitest";
import { resolveDevTestLogin } from "../src/service/dev-login";

describe("개발용 테스트 로그인 가드", () => {
  it("개발·테스트 환경에서 DEV_TEST_LOGIN=true면 켜진다", () => {
    expect(resolveDevTestLogin({ NODE_ENV: "development", DEV_TEST_LOGIN: "true" })).toBe(true);
    expect(resolveDevTestLogin({ NODE_ENV: "test", DEV_TEST_LOGIN: "true" })).toBe(true);
  });

  it("값이 없거나 true가 아니면 꺼진다", () => {
    expect(resolveDevTestLogin({ NODE_ENV: "development" })).toBe(false);
    expect(resolveDevTestLogin({ NODE_ENV: "development", DEV_TEST_LOGIN: "1" })).toBe(false);
  });

  it("운영 환경에서 켜려고 하면 기동을 막는다", () => {
    expect(() => resolveDevTestLogin({ NODE_ENV: "production", DEV_TEST_LOGIN: "true" })).toThrow(
      /운영 환경/,
    );
    expect(resolveDevTestLogin({ NODE_ENV: "production" })).toBe(false);
  });

  it("스테이징(APP_ENV=staging)만 운영 모드에서도 켤 수 있고, 다른 값은 막는다", () => {
    expect(
      resolveDevTestLogin({ NODE_ENV: "production", DEV_TEST_LOGIN: "true", APP_ENV: "staging" }),
    ).toBe(true);
    for (const appEnv of ["production", "prod", "Staging", "", undefined]) {
      expect(() =>
        resolveDevTestLogin({ NODE_ENV: "production", DEV_TEST_LOGIN: "true", APP_ENV: appEnv }),
      ).toThrow(/운영 환경/);
    }
    // APP_ENV=staging만으로는 켜지지 않는다 (DEV_TEST_LOGIN=true를 따로 요청해야 한다)
    expect(resolveDevTestLogin({ NODE_ENV: "production", APP_ENV: "staging" })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { resolveDevTestLogin } from "./dev-login";

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
});

import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

// 웹 푸시(VAPID) 선택 값 검증. 최소 필수 값만 채운 기준 환경에 VAPID만 더한다
const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/app",
  AUTH_DATABASE_URL: "postgres://u:p@localhost:5432/auth",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  S3_BUCKET: "bucket",
  S3_ACCESS_KEY_ID: "id",
  S3_SECRET_ACCESS_KEY: "secret",
};
const vapid = {
  VAPID_PUBLIC_KEY: "BPublicKeyExample",
  VAPID_PRIVATE_KEY: "PrivateKeyExample",
  VAPID_SUBJECT: "mailto:ops@example.com",
};

describe("서버 env: 웹 푸시(VAPID) 선택 값", () => {
  it("VAPID가 모두 없으면 부팅이 되고 값은 undefined다 (푸시 꺼짐)", () => {
    const env = parseServerEnv(base);
    expect(env.VAPID_PUBLIC_KEY).toBeUndefined();
    expect(env.VAPID_PRIVATE_KEY).toBeUndefined();
    expect(env.VAPID_SUBJECT).toBeUndefined();
  });

  it("빈 문자열(compose의 `VAR=`)은 없는 값으로 본다", () => {
    const env = parseServerEnv({
      ...base,
      VAPID_PUBLIC_KEY: "",
      VAPID_PRIVATE_KEY: "",
      VAPID_SUBJECT: "",
    });
    expect(env.VAPID_PUBLIC_KEY).toBeUndefined();
    expect(env.VAPID_PRIVATE_KEY).toBeUndefined();
    expect(env.VAPID_SUBJECT).toBeUndefined();
  });

  it("세 값이 모두 있으면 그대로 읽는다", () => {
    const env = parseServerEnv({ ...base, ...vapid });
    expect(env.VAPID_PUBLIC_KEY).toBe(vapid.VAPID_PUBLIC_KEY);
    expect(env.VAPID_PRIVATE_KEY).toBe(vapid.VAPID_PRIVATE_KEY);
    expect(env.VAPID_SUBJECT).toBe(vapid.VAPID_SUBJECT);
  });

  it("세 값 중 일부만 있으면 부팅을 막는다", () => {
    expect(() => parseServerEnv({ ...base, VAPID_PUBLIC_KEY: "BPub" })).toThrow();
  });

  it("VAPID_SUBJECT는 mailto: 또는 https:만 받는다", () => {
    expect(() => parseServerEnv({ ...base, ...vapid, VAPID_SUBJECT: "ops@example.com" })).toThrow();
    expect(() =>
      parseServerEnv({ ...base, ...vapid, VAPID_SUBJECT: "https://example.com" }),
    ).not.toThrow();
  });
});

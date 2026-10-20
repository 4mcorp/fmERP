// 테스트 DB 대상 URL 도우미 단위 시험. 실제 DB에는 접속하지 않는다.
import { describe, expect, it } from "vitest";
import { assertDroppableScratchDb, testServerUrl } from "./test-db-url";

const SHARED = "postgres://postgres:postgres@localhost:55433";
const ISOLATED = "postgres://postgres:postgres@localhost:55544";

describe("테스트 서버 URL (환경변수 미지정 = 공유 테스트 DB 55433/fmerp)", () => {
  it("기존 주소(55433)와 같다", () => {
    expect(testServerUrl("postgres", {})).toBe(`${SHARED}/postgres`);
    expect(testServerUrl("m7_restore_x", {})).toBe(`${SHARED}/m7_restore_x`);
  });

  it("TEST_DB_PORT를 설정하면 관리 연결과 임시 DB 연결이 같은 포트를 쓴다", () => {
    const env = { TEST_DB_PORT: "55544", TEST_DB_NAME: "fmerp_test_b2" };
    expect(testServerUrl("postgres", env)).toBe(`${ISOLATED}/postgres`);
    expect(testServerUrl("fmerp_rehearse_x", env)).toBe(`${ISOLATED}/fmerp_rehearse_x`);
  });

  it("개발 포트, 허용목록 밖의 포트·DB 이름은 거부한다", () => {
    expect(() =>
      testServerUrl("postgres", { TEST_DB_PORT: "55432", TEST_DB_NAME: "fmerp_test" }),
    ).toThrow("개발 DB 포트");
    expect(() =>
      testServerUrl("postgres", { TEST_DB_PORT: "5432", TEST_DB_NAME: "fmerp" }),
    ).toThrow("허용되지 않은 테스트 DB 포트");
    expect(() =>
      testServerUrl("postgres", { TEST_DB_PORT: "55500", TEST_DB_NAME: "fmerp_test_b2" }),
    ).toThrow("허용되지 않은 테스트 DB 포트");
    expect(() => testServerUrl("postgres", { TEST_DB_NAME: "other_db" })).toThrow(
      "허용되지 않은 테스트 DB 이름",
    );
  });
});

describe("임시 DB 삭제 가드", () => {
  it("시험이 만든 접두어의 임시 DB만 지울 수 있다", () => {
    expect(() =>
      assertDroppableScratchDb("fmerp_rehearse_abc", "fmerp_rehearse_", {}),
    ).not.toThrow();
    expect(() => assertDroppableScratchDb("fmerp", "fmerp_rehearse_", {})).toThrow(
      "지우지 않습니다",
    );
    expect(() => assertDroppableScratchDb("postgres", "fmerp_rehearse_", {})).toThrow(
      "지우지 않습니다",
    );
  });

  it("테스트 대상 DB(TEST_DB_NAME)는 접두어가 맞아도 지우지 않는다", () => {
    expect(() =>
      assertDroppableScratchDb("fmerp_test_b2", "fmerp_test", {
        TEST_DB_PORT: "55544",
        TEST_DB_NAME: "fmerp_test_b2",
      }),
    ).toThrow("지우지 않습니다");
  });
});

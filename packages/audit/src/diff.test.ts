import { describe, expect, it } from "vitest";
import { computeAuditDiff, MASK } from "./diff";

describe("computeAuditDiff", () => {
  it("바뀐 필드만 이전·이후 값으로 기록한다", () => {
    expect(
      computeAuditDiff({ name: "김OO", role: "member" }, { name: "김OO", role: "admin" }),
    ).toEqual([{ op: "change", path: "role", oldValue: "member", value: "admin" }]);
  });

  it("추가·삭제를 구분한다", () => {
    expect(computeAuditDiff({ a: 1 }, { b: 2 })).toEqual([
      { op: "remove", path: "a", oldValue: 1 },
      { op: "add", path: "b", value: 2 },
    ]);
  });

  it("토큰·비밀번호·PIN 등 민감 필드는 값을 남기지 않는다 (AUD-027)", () => {
    const result = computeAuditDiff(
      { pinHash: "SECRET-PIN-1", nested: { accessToken: "SECRET-TOKEN-1" } },
      { pinHash: "SECRET-PIN-2", nested: { accessToken: "SECRET-TOKEN-2" } },
    );
    expect(result).toEqual([
      { op: "change", path: "pinHash", oldValue: MASK, value: MASK },
      { op: "change", path: "nested.accessToken", oldValue: MASK, value: MASK },
    ]);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
});

import { describe, expect, it } from "vitest";
import { allowedTransitions, assertTransition, canTransition } from "./approval-state";
import { DOC_STATUSES, type DocStatus } from "./approval-types";

// PRD 5.4.1 상태도를 그대로 옮긴 기대 표
const EXPECTED: Record<DocStatus, DocStatus[]> = {
  DRAFT: ["IN_PROGRESS"],
  IN_PROGRESS: ["WITHDRAWN", "ON_HOLD", "REJECTED", "COMPLETED"],
  ON_HOLD: ["IN_PROGRESS"],
  WITHDRAWN: ["DRAFT"],
  REJECTED: [],
  COMPLETED: ["CANCELED", "ARCHIVED"],
  CANCELED: [],
  ARCHIVED: [],
};

describe("문서 상태 전이 (PRD 5.4.1)", () => {
  it("모든 (출발, 도착) 조합이 상태도와 일치한다", () => {
    for (const from of DOC_STATUSES) {
      for (const to of DOC_STATUSES) {
        expect(canTransition(from, to), `${from} → ${to}`).toBe(EXPECTED[from].includes(to));
      }
    }
  });

  it("허용 전이 목록을 돌려준다", () => {
    expect(allowedTransitions("IN_PROGRESS")).toEqual(EXPECTED.IN_PROGRESS);
  });

  it("허용되지 않은 전이는 예외를 던진다", () => {
    expect(() => assertTransition("COMPLETED", "DRAFT")).toThrow(/COMPLETED/);
    expect(() => assertTransition("IN_PROGRESS", "COMPLETED")).not.toThrow();
  });
});

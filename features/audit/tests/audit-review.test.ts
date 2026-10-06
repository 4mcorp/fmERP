import { describe, expect, it } from "vitest";
import { type AuditReviewRecord, reviewStatuses, reviewTargetPeriod } from "./audit-review";

const rec = (period: string, at: string, abnormal = false): AuditReviewRecord => ({
  period,
  reviewedAt: new Date(at),
  abnormal,
});

describe("월간 점검 대상 달 (AUD-026)", () => {
  it("점검 대상은 직전 달이다 (KST 기준)", () => {
    expect(reviewTargetPeriod(new Date("2026-10-05T00:00:00Z"))).toBe("2026-09");
    expect(reviewTargetPeriod(new Date("2026-01-15T00:00:00Z"))).toBe("2025-12");
  });

  it("UTC로는 전달 말이어도 KST로 달이 바뀌었으면 새 달 기준이다", () => {
    // 2026-09-30 16:00 UTC = 2026-10-01 01:00 KST
    expect(reviewTargetPeriod(new Date("2026-09-30T16:00:00Z"))).toBe("2026-09");
    expect(reviewTargetPeriod(new Date("2026-09-30T14:59:00Z"))).toBe("2026-08");
  });
});

describe("월별 점검 상태", () => {
  const now = new Date("2026-10-05T00:00:00Z");

  it("직전 달부터 거꾸로 months개를 최신순으로 돌려주고 현재 달은 넣지 않는다", () => {
    const list = reviewStatuses(now, [], 3);
    expect(list.map((r) => r.period)).toEqual(["2026-09", "2026-08", "2026-07"]);
    expect(list.every((r) => r.state === "pending" && r.last === null)).toBe(true);
  });

  it("연도를 넘어 거슬러 올라간다", () => {
    const list = reviewStatuses(new Date("2026-02-10T00:00:00Z"), [], 3);
    expect(list.map((r) => r.period)).toEqual(["2026-01", "2025-12", "2025-11"]);
  });

  it("점검 기록이 있으면 완료, 이상 표시가 있으면 이상 있음", () => {
    const list = reviewStatuses(
      now,
      [rec("2026-09", "2026-10-02T00:00:00Z"), rec("2026-08", "2026-09-03T00:00:00Z", true)],
      3,
    );
    expect(list.map((r) => r.state)).toEqual(["done", "abnormal", "pending"]);
  });

  it("같은 달 여러 건이면 가장 마지막 기록이 현재 상태다 (정정)", () => {
    const list = reviewStatuses(
      now,
      [
        rec("2026-09", "2026-10-02T00:00:00Z", true),
        rec("2026-09", "2026-10-04T00:00:00Z", false),
        rec("2026-09", "2026-10-03T00:00:00Z", true),
      ],
      1,
    );
    expect(list[0]?.state).toBe("done");
    expect(list[0]?.last?.reviewedAt.toISOString()).toBe("2026-10-04T00:00:00.000Z");
  });

  it("범위 밖 달의 기록은 무시한다", () => {
    const list = reviewStatuses(now, [rec("2026-10", "2026-10-04T00:00:00Z")], 2);
    expect(list.map((r) => r.state)).toEqual(["pending", "pending"]);
  });
});

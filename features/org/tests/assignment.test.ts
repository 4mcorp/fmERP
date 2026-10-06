import { describe, expect, it } from "vitest";
import {
  type AssignmentInput,
  assignmentChanges,
  isAssignmentActive,
  pickDraftAssignment,
  snapshotAssignment,
  validateAssignments,
} from "../src/domain/assignment";

const now = new Date("2026-10-03T00:00:00Z");
const base: AssignmentInput = {
  id: "a1",
  businessId: "b1",
  departmentId: "d1",
  positionId: "p1",
  dutyId: null,
  isPrimary: true,
  validFrom: new Date("2026-01-01T00:00:00Z"),
  validTo: null,
};

describe("소속 유효 기간", () => {
  it("시작일 이후이고 종료일 전이면 유효하다", () => {
    expect(isAssignmentActive(base, now)).toBe(true);
    expect(isAssignmentActive({ ...base, validFrom: new Date("2027-01-01T00:00:00Z") }, now)).toBe(
      false,
    );
    expect(isAssignmentActive({ ...base, validTo: new Date("2026-09-01T00:00:00Z") }, now)).toBe(
      false,
    );
  });
});

describe("소속 검증 (PRD ORG-032·033)", () => {
  it("유효한 소속이 하나라도 있으면 주소속이 정확히 1개여야 한다", () => {
    expect(validateAssignments([base], now)).toEqual({ ok: true });
    expect(validateAssignments([], now)).toEqual({ ok: true });
    expect(validateAssignments([{ ...base, isPrimary: false }], now).ok).toBe(false);
    expect(validateAssignments([base, { ...base, id: "a2" }], now).ok).toBe(false);
  });

  it("겸직(다른 사업자·부서)은 주소속 1개와 함께 허용한다", () => {
    const side = { ...base, id: "a2", businessId: "b2", departmentId: "d9", isPrimary: false };
    expect(validateAssignments([base, side], now)).toEqual({ ok: true });
  });

  it("종료된 소속의 주소속 표시는 개수에 포함하지 않는다", () => {
    const ended = { ...base, id: "old", validTo: new Date("2026-02-01T00:00:00Z") };
    expect(validateAssignments([ended, { ...base, id: "a2" }], now)).toEqual({ ok: true });
  });
});

describe("기안 소속 선택 (PRD ORG-033)", () => {
  const side = { ...base, id: "a2", isPrimary: false };

  it("지정하지 않으면 주소속을 고른다", () => {
    expect(pickDraftAssignment([side, base], undefined, now)?.id).toBe("a1");
  });

  it("지정한 소속이 유효하면 그것을 고른다", () => {
    expect(pickDraftAssignment([base, side], "a2", now)?.id).toBe("a2");
  });

  it("지정한 소속이 없거나 종료됐으면 null", () => {
    expect(pickDraftAssignment([base], "zz", now)).toBeNull();
  });
});

describe("발령 변경 내역 (PRD ORG-035)", () => {
  it("바뀐 항목만 돌려준다", () => {
    expect(assignmentChanges(base, { ...base, departmentId: "d2", positionId: "p2" })).toEqual({
      departmentId: { from: "d1", to: "d2" },
      positionId: { from: "p1", to: "p2" },
    });
    expect(assignmentChanges(base, base)).toEqual({});
  });
});

describe("결재 시점 스냅샷 (PRD ORG-017)", () => {
  it("이름을 복사해 이후 조직 변경과 분리한다", () => {
    expect(
      snapshotAssignment({
        businessName: "포엠",
        departmentName: "재무팀",
        positionName: "과장",
        dutyName: "팀장",
      }),
    ).toEqual({
      businessName: "포엠",
      departmentName: "재무팀",
      positionName: "과장",
      dutyName: "팀장",
    });
  });
});

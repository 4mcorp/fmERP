import { describe, expect, it } from "vitest";
import type { ApprovalDoc, ApprovalStep } from "../src/domain/approval-types";
import { DEFAULT_POLICY } from "../src/domain/approval-types";
import { planTransfer } from "../src/domain/step-transfer";

const step = (over: Partial<ApprovalStep> & { id: string }): ApprovalStep => ({
  seq: 1,
  type: "approve",
  assigneeIds: ["old"],
  delegates: {},
  canFinalize: false,
  quorum: "all",
  status: "PENDING",
  version: 1,
  heldBy: null,
  ...over,
});

const doc = (
  steps: ApprovalStep[],
  status: ApprovalDoc["status"] = "IN_PROGRESS",
): ApprovalDoc => ({
  id: "d1",
  status,
  drafterId: "drafter",
  policy: DEFAULT_POLICY,
  steps,
});

describe("planTransfer (ADM-005 결재자 일괄 이관)", () => {
  it("처리 전(PENDING·ACTIVE·HELD) 단계의 처리자를 교체한다", () => {
    const d = doc([
      step({ id: "s1", seq: 1, status: "ACTIVE" }),
      step({ id: "s2", seq: 2, status: "PENDING" }),
      step({ id: "s3", seq: 3, status: "HELD" }),
    ]);
    const r = planTransfer(d, { from: "old", to: "new", reason: "퇴사" });
    expect(r).toEqual({
      ok: true,
      changes: [
        { stepId: "s1", assigneeIds: ["new"] },
        { stepId: "s2", assigneeIds: ["new"] },
        { stepId: "s3", assigneeIds: ["new"] },
      ],
    });
  });

  it("이미 처리한 단계는 건드리지 않는다", () => {
    const d = doc([
      step({ id: "s1", seq: 1, status: "APPROVED" }),
      step({ id: "s2", seq: 2, status: "REJECTED" }),
      step({ id: "s3", seq: 3, status: "SKIPPED" }),
      step({ id: "s4", seq: 4, status: "ACTIVE" }),
    ]);
    const r = planTransfer(d, { from: "old", to: "new", reason: "퇴사" });
    expect(r.ok && r.changes.map((c) => c.stepId)).toEqual(["s4"]);
  });

  it("여러 명이 처리할 수 있는 단계는 대상자만 바꾸고 나머지는 유지한다", () => {
    const d = doc([step({ id: "s1", status: "ACTIVE", assigneeIds: ["a", "old", "b"] })]);
    const r = planTransfer(d, { from: "old", to: "new", reason: "휴직" });
    expect(r.ok && r.changes[0]?.assigneeIds).toEqual(["a", "new", "b"]);
  });

  it("대체자가 이미 그 단계의 처리자이면 중복 없이 대상자만 뺀다", () => {
    const d = doc([step({ id: "s1", status: "ACTIVE", assigneeIds: ["old", "new"] })]);
    const r = planTransfer(d, { from: "old", to: "new", reason: "휴직" });
    expect(r.ok && r.changes[0]?.assigneeIds).toEqual(["new"]);
  });

  it("이관 대상 단계가 없으면 changes가 비어 있다", () => {
    const d = doc([step({ id: "s1", status: "ACTIVE", assigneeIds: ["other"] })]);
    expect(planTransfer(d, { from: "old", to: "new", reason: "퇴사" })).toEqual({
      ok: true,
      changes: [],
    });
  });

  it("진행 중이 아닌 문서는 이관하지 않는다", () => {
    for (const status of ["DRAFT", "COMPLETED", "WITHDRAWN", "REJECTED", "CANCELED"] as const) {
      const r = planTransfer(doc([step({ id: "s1", status: "ACTIVE" })], status), {
        from: "old",
        to: "new",
        reason: "퇴사",
      });
      expect(r).toMatchObject({ ok: false, code: "invalid_state" });
    }
  });

  it("보류(ON_HOLD) 문서는 이관할 수 있다", () => {
    const r = planTransfer(doc([step({ id: "s1", status: "HELD" })], "ON_HOLD"), {
      from: "old",
      to: "new",
      reason: "퇴사",
    });
    expect(r.ok).toBe(true);
  });

  it("사유가 비어 있으면 거부한다", () => {
    const r = planTransfer(doc([step({ id: "s1", status: "ACTIVE" })]), {
      from: "old",
      to: "new",
      reason: "  ",
    });
    expect(r).toMatchObject({ ok: false, code: "reason_required" });
  });

  it("같은 사람으로는 이관할 수 없다", () => {
    const r = planTransfer(doc([step({ id: "s1", status: "ACTIVE" })]), {
      from: "old",
      to: "old",
      reason: "퇴사",
    });
    expect(r).toMatchObject({ ok: false, code: "invalid_transfer" });
  });
});

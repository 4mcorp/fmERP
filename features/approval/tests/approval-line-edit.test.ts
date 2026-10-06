import { describe, expect, it } from "vitest";
import { submit } from "../src/domain/approval-engine";
import { editLine } from "../src/domain/approval-line-edit";
import {
  type ApprovalDoc,
  type ApprovalStep,
  DEFAULT_POLICY,
  type EngineContext,
  type StepType,
} from "../src/domain/approval-types";

const ctx: EngineContext = {
  now: new Date("2026-10-03T00:00:00Z"),
  decideDelegate: () => ({ kind: "none" }),
};

const step = (id: string, seq: number, type: StepType, who: string): ApprovalStep => ({
  id,
  seq,
  type,
  assigneeIds: [who],
  delegates: {},
  canFinalize: false,
  quorum: "all",
  status: "PENDING",
  version: 0,
  heldBy: null,
});

function inProgress(): ApprovalDoc {
  const r = submit(
    {
      id: "d1",
      status: "DRAFT",
      drafterId: "drafter",
      policy: DEFAULT_POLICY,
      steps: [
        step("a", 1, "approve", "u1"),
        step("b", 2, "approve", "u2"),
        step("c", 3, "approve", "u3"),
      ],
    },
    ctx,
  );
  if (!r.ok) throw new Error("submit failed");
  return r.doc;
}

const opts = { reason: "결재자 추가 요청", allowLineEdit: true };
const actor = (id: string, admin = false) => ({ membershipId: id, isApprovalAdmin: admin });
const add = (id: string, seq: number, who: string, type: StepType = "approve") => ({
  kind: "add" as const,
  step: { id, seq, type, assigneeIds: [who] },
});

describe("진행 중 결재선 변경 (APV-037)", () => {
  it("현재 처리자가 아직 처리 전인 이후 단계를 추가·삭제한다", () => {
    const r = editLine(
      inProgress(),
      [add("x", 4, "u9"), { kind: "remove", stepId: "c" }],
      actor("u1"),
      opts,
    );
    expect(r).toMatchObject({ ok: true, addedStepIds: ["x"], removedStepIds: ["c"] });
    if (r.ok) {
      expect(r.doc.steps.map((s) => s.id)).toEqual(["a", "b", "x"]);
      expect(r.doc.steps.find((s) => s.id === "x")).toMatchObject({
        status: "PENDING",
        version: 0,
      });
      expect(r.events).toContainEqual({
        type: "line_changed",
        docId: "d1",
        added: ["x"],
        removed: ["c"],
        reason: "결재자 추가 요청",
      });
    }
  });

  it("결재 관리자는 처리자가 아니어도 변경할 수 있고, 다른 사람은 거부", () => {
    expect(editLine(inProgress(), [add("x", 4, "u9")], actor("zzz", true), opts).ok).toBe(true);
    expect(editLine(inProgress(), [add("x", 4, "u9")], actor("zzz"), opts)).toMatchObject({
      ok: false,
      code: "not_assignee",
    });
    // 기안자도 진행 중에는 결재선을 바꿀 수 없다 (회수 후 수정)
    expect(editLine(inProgress(), [add("x", 4, "u9")], actor("drafter"), opts)).toMatchObject({
      ok: false,
    });
  });

  it("사유가 없으면 거부", () => {
    expect(
      editLine(inProgress(), [add("x", 4, "u9")], actor("u1"), { ...opts, reason: "  " }),
    ).toMatchObject({
      ok: false,
      code: "reason_required",
    });
  });

  it("양식이 허용하지 않으면 거부", () => {
    expect(
      editLine(inProgress(), [add("x", 4, "u9")], actor("u1"), { ...opts, allowLineEdit: false }),
    ).toMatchObject({
      ok: false,
      code: "line_edit_not_allowed",
    });
  });

  it("처리했거나 처리 중인 단계는 삭제할 수 없다", () => {
    expect(
      editLine(inProgress(), [{ kind: "remove", stepId: "a" }], actor("u1"), opts),
    ).toMatchObject({
      ok: false,
      code: "invalid_edit",
    });
  });

  it("이미 지난·진행 중인 순번 이전에는 단계를 끼워 넣을 수 없다", () => {
    // a(1)가 활성이므로 seq 1에 추가하면 이미 열린 그룹에 끼어든다
    expect(editLine(inProgress(), [add("x", 1, "u9")], actor("u1"), opts)).toMatchObject({
      ok: false,
      code: "invalid_edit",
    });
    expect(editLine(inProgress(), [add("x", 2, "u9")], actor("u1"), opts).ok).toBe(true); // 대기 중인 그룹에는 합류 가능
  });

  it("진행 중이 아닌 문서·없는 단계·빈 변경은 거부", () => {
    const draft = { ...inProgress(), status: "COMPLETED" as const };
    expect(editLine(draft, [add("x", 4, "u9")], actor("u1"), opts)).toMatchObject({
      ok: false,
      code: "invalid_state",
    });
    expect(
      editLine(inProgress(), [{ kind: "remove", stepId: "nope" }], actor("u1"), opts),
    ).toMatchObject({ ok: false });
    expect(editLine(inProgress(), [], actor("u1"), opts)).toMatchObject({
      ok: false,
      code: "invalid_edit",
    });
  });

  it("중복 단계 id와 빈 처리자는 거부", () => {
    expect(editLine(inProgress(), [add("b", 4, "u9")], actor("u1"), opts)).toMatchObject({
      ok: false,
      code: "invalid_edit",
    });
    expect(
      editLine(
        inProgress(),
        [{ kind: "add", step: { id: "x", seq: 4, type: "approve", assigneeIds: [] } }],
        actor("u1"),
        opts,
      ),
    ).toMatchObject({ ok: false, code: "invalid_edit" });
  });

  it("입력 문서는 바뀌지 않는다", () => {
    const doc = inProgress();
    editLine(doc, [add("x", 4, "u9")], actor("u1"), opts);
    expect(doc.steps).toHaveLength(3);
  });
});

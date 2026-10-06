import { describe, expect, it } from "vitest";
import {
  act,
  redraftSeed,
  reopenDraft,
  submit,
  transitionDocument,
  withdraw,
} from "../src/domain/approval-engine";
import {
  type ApprovalAction,
  type ApprovalDoc,
  type ApprovalPolicy,
  type ApprovalStep,
  DEFAULT_POLICY,
  type DelegateDecision,
  type EngineContext,
  type EngineResult,
  type StepType,
} from "../src/domain/approval-types";

const now = new Date("2026-10-03T09:00:00+09:00");
const noDelegates: EngineContext = { now, decideDelegate: () => ({ kind: "none" }) };

function step(
  id: string,
  seq: number,
  type: StepType,
  assignees: string | string[],
  extra: Partial<ApprovalStep> = {},
): ApprovalStep {
  return {
    id,
    seq,
    type,
    assigneeIds: Array.isArray(assignees) ? assignees : [assignees],
    delegates: {},
    canFinalize: false,
    quorum: "all",
    status: "PENDING",
    version: 0,
    heldBy: null,
    ...extra,
  };
}

function draft(steps: ApprovalStep[], policy: Partial<ApprovalPolicy> = {}): ApprovalDoc {
  return {
    id: "doc1",
    status: "DRAFT",
    drafterId: "drafter",
    policy: { ...DEFAULT_POLICY, ...policy },
    steps,
  };
}

function ok(result: EngineResult) {
  if (!result.ok) throw new Error(`실패: ${result.code} ${result.message}`);
  return result;
}

function submitted(steps: ApprovalStep[], policy?: Partial<ApprovalPolicy>, ctx = noDelegates) {
  return ok(submit(draft(steps, policy), ctx)).doc;
}

const status = (doc: ApprovalDoc, id: string) => doc.steps.find((s) => s.id === id)?.status;
const run = (
  doc: ApprovalDoc,
  stepId: string,
  action: ApprovalAction,
  actor: string,
  ctx = noDelegates,
) => act(doc, stepId, action, { membershipId: actor }, ctx);

describe("상신 (submit)", () => {
  it("첫 그룹을 활성화하고 문서를 IN_PROGRESS로 만든다", () => {
    const r = ok(
      submit(draft([step("a", 1, "approve", "u1"), step("b", 2, "approve", "u2")]), noDelegates),
    );
    expect(r.doc.status).toBe("IN_PROGRESS");
    expect(status(r.doc, "a")).toBe("ACTIVE");
    expect(status(r.doc, "b")).toBe("PENDING");
    expect(r.events.map((e) => e.type)).toEqual(["submitted", "step_activated"]);
  });

  it("진행 단계가 없거나 후결뿐이면 거부한다", () => {
    expect(submit(draft([]), noDelegates)).toMatchObject({ ok: false, code: "nothing_to_submit" });
    expect(submit(draft([step("p", 9, "post", "u1")]), noDelegates)).toMatchObject({
      ok: false,
      code: "nothing_to_submit",
    });
  });

  it("DRAFT가 아닌 문서는 상신할 수 없다", () => {
    const doc = submitted([step("a", 1, "approve", "u1")]);
    expect(submit(doc, noDelegates)).toMatchObject({ ok: false, code: "invalid_state" });
  });

  it("상신한 문서를 원본과 분리해 돌려준다 (불변 갱신)", () => {
    const original = draft([step("a", 1, "approve", "u1")]);
    ok(submit(original, noDelegates));
    expect(original.status).toBe("DRAFT");
    expect(original.steps[0]?.status).toBe("PENDING");
  });
});

describe("순차 결재와 완료", () => {
  const line = () => [
    step("a", 1, "approve", "u1"),
    step("b", 2, "approve", "u2"),
    step("c", 3, "approve", "u3"),
  ];

  it("차례대로 승인하면 마지막 승인 시 COMPLETED가 된다", () => {
    let doc = submitted(line());
    doc = ok(run(doc, "a", { kind: "approve" }, "u1")).doc;
    expect(status(doc, "a")).toBe("APPROVED");
    expect(status(doc, "b")).toBe("ACTIVE");
    doc = ok(run(doc, "b", { kind: "approve" }, "u2")).doc;
    const last = ok(run(doc, "c", { kind: "approve" }, "u3"));
    expect(last.doc.status).toBe("COMPLETED");
    expect(last.events.map((e) => e.type)).toContain("completed");
  });

  it("차례가 아닌 단계는 처리할 수 없다", () => {
    const doc = submitted(line());
    expect(run(doc, "b", { kind: "approve" }, "u2")).toMatchObject({
      ok: false,
      code: "step_not_active",
    });
  });

  it("처리자가 아닌 사람은 처리할 수 없다", () => {
    const doc = submitted(line());
    expect(run(doc, "a", { kind: "approve" }, "u2")).toMatchObject({
      ok: false,
      code: "not_assignee",
    });
    expect(run(doc, "a", { kind: "approve" }, "drafter")).toMatchObject({
      ok: false,
      code: "not_assignee",
    });
  });

  it("처리 결과로 단계 version이 오르고 changedStepIds에 담긴다", () => {
    const doc = submitted(line());
    const r = ok(run(doc, "a", { kind: "approve" }, "u1"));
    expect(r.doc.steps.find((s) => s.id === "a")?.version).toBe(2); // 활성화 +1, 승인 +1
    expect(r.changedStepIds.sort()).toEqual(["a", "b"]);
  });

  it("처리 기록을 돌려준다 (행위자·시각·의견)", () => {
    const doc = submitted(line());
    const r = ok(run(doc, "a", { kind: "approve" }, "u1"));
    expect(r.record).toEqual({
      stepId: "a",
      action: "approve",
      actorId: "u1",
      onBehalfOf: null,
      comment: null,
      at: now,
    });
  });

  it("낙관적 잠금: 기대 version이 다르면 충돌", () => {
    const doc = submitted(line());
    const r = act(doc, "a", { kind: "approve" }, { membershipId: "u1" }, noDelegates, 99);
    expect(r).toMatchObject({ ok: false, code: "version_conflict" });
    const current = doc.steps.find((s) => s.id === "a")?.version;
    expect(
      act(doc, "a", { kind: "approve" }, { membershipId: "u1" }, noDelegates, current).ok,
    ).toBe(true);
  });

  it("완료된 문서는 후결 외에 어떤 처리도 받지 않는다 (APV-062)", () => {
    let doc = submitted([step("a", 1, "approve", "u1")]);
    doc = ok(run(doc, "a", { kind: "approve" }, "u1")).doc;
    expect(doc.status).toBe("COMPLETED");
    expect(run(doc, "a", { kind: "approve" }, "u1")).toMatchObject({
      ok: false,
      code: "invalid_state",
    });
    expect(run(doc, "a", { kind: "reject", comment: "x" }, "u1")).toMatchObject({ ok: false });
  });
});

describe("행위 허용 범위", () => {
  it("결재 단계에서 합의·감사 행위는 거부한다", () => {
    const doc = submitted([step("a", 1, "approve", "u1")]);
    for (const kind of ["agree", "audit_approve"] as const) {
      expect(run(doc, "a", { kind }, "u1")).toMatchObject({
        ok: false,
        code: "action_not_allowed",
      });
    }
  });

  it("합의 단계에서 승인(approve)은 거부하고 동의는 허용한다", () => {
    const doc = submitted([step("g", 1, "agree", "u1")]);
    expect(run(doc, "g", { kind: "approve" }, "u1")).toMatchObject({
      ok: false,
      code: "action_not_allowed",
    });
    expect(run(doc, "g", { kind: "agree" }, "u1").ok).toBe(true);
  });

  it("반려·부동의·감사 반려·의견은 사유가 필수다 (APV-041)", () => {
    const a = submitted([step("a", 1, "approve", "u1")]);
    expect(run(a, "a", { kind: "reject", comment: "  " }, "u1")).toMatchObject({
      code: "comment_required",
    });
    const g = submitted([step("g", 1, "agree", "u1")]);
    expect(run(g, "g", { kind: "disagree", comment: "" }, "u1")).toMatchObject({
      code: "comment_required",
    });
    const au = submitted([step("x", 1, "audit", "u1")]);
    expect(run(au, "x", { kind: "audit_reject", comment: "" }, "u1")).toMatchObject({
      code: "comment_required",
    });
    expect(run(au, "x", { kind: "audit_comment", comment: "" }, "u1")).toMatchObject({
      code: "comment_required",
    });
  });
});

describe("반려 (APV-041)", () => {
  const line = () => [
    step("a", 1, "approve", "u1"),
    step("b", 2, "agree", "u2"),
    step("c", 3, "approve", "u3"),
  ];

  it("기본은 기안자에게 반려: 문서 REJECTED, rejected 이벤트", () => {
    let doc = submitted(line());
    doc = ok(run(doc, "a", { kind: "approve" }, "u1")).doc;
    doc = ok(run(doc, "b", { kind: "agree" }, "u2")).doc;
    const r = ok(run(doc, "c", { kind: "reject", comment: "금액 불일치" }, "u3"));
    expect(r.doc.status).toBe("REJECTED");
    expect(status(r.doc, "c")).toBe("REJECTED");
    expect(r.events).toContainEqual({
      type: "rejected",
      docId: "doc1",
      stepId: "c",
      comment: "금액 불일치",
    });
    expect(r.record?.comment).toBe("금액 불일치");
  });

  it("직전 결재 단계로 반려: 이전 결재 단계가 다시 ACTIVE, 이후는 PENDING, 이력은 유지", () => {
    let doc = submitted(line(), { rejectTo: "previous" });
    doc = ok(run(doc, "a", { kind: "approve" }, "u1")).doc;
    doc = ok(run(doc, "b", { kind: "agree" }, "u2")).doc;
    const r = ok(run(doc, "c", { kind: "reject", comment: "재검토" }, "u3"));
    expect(r.doc.status).toBe("IN_PROGRESS");
    expect(status(r.doc, "a")).toBe("ACTIVE");
    expect(status(r.doc, "b")).toBe("PENDING");
    expect(status(r.doc, "c")).toBe("PENDING");
    expect(r.events.map((e) => e.type)).toContain("reactivated");
    // 다시 처리하면 끝까지 진행된다
    let again = ok(run(r.doc, "a", { kind: "approve" }, "u1")).doc;
    again = ok(run(again, "b", { kind: "agree" }, "u2")).doc;
    expect(ok(run(again, "c", { kind: "approve" }, "u3")).doc.status).toBe("COMPLETED");
  });

  it("직전 결재 단계가 없으면 기안자에게 반려한다", () => {
    const doc = submitted([step("a", 1, "approve", "u1")], { rejectTo: "previous" });
    expect(ok(run(doc, "a", { kind: "reject", comment: "x" }, "u1")).doc.status).toBe("REJECTED");
  });
});

describe("합의·협조 (APV-030·040)", () => {
  it("부동의: 기본은 반려, comment 정책이면 의견만 남기고 진행", () => {
    const line = () => [step("g", 1, "agree", "u1"), step("b", 2, "approve", "u2")];
    const rejected = ok(run(submitted(line()), "g", { kind: "disagree", comment: "반대" }, "u1"));
    expect(rejected.doc.status).toBe("REJECTED");
    const passed = ok(
      run(
        submitted(line(), { disagree: "comment" }),
        "g",
        { kind: "disagree", comment: "반대" },
        "u1",
      ),
    );
    expect(passed.doc.status).toBe("IN_PROGRESS");
    expect(status(passed.doc, "g")).toBe("APPROVED");
    expect(status(passed.doc, "b")).toBe("ACTIVE");
  });

  it("협조 단계는 부동의해도 반려하지 않는다", () => {
    const doc = submitted([step("c", 1, "cooperate", "u1"), step("b", 2, "approve", "u2")]);
    const r = ok(run(doc, "c", { kind: "disagree", comment: "의견" }, "u1"));
    expect(r.doc.status).toBe("IN_PROGRESS");
    expect(status(r.doc, "b")).toBe("ACTIVE");
  });
});

describe("병렬 그룹 (APV-032)", () => {
  const parallel = (quorum: "all" | number) => [
    step("p1", 1, "agree", "u1", { quorum }),
    step("p2", 1, "agree", "u2", { quorum }),
    step("p3", 1, "agree", "u3", { quorum }),
    step("n", 2, "approve", "u4"),
  ];

  it("같은 seq 단계가 동시에 활성화된다", () => {
    const doc = submitted(parallel("all"));
    expect(["p1", "p2", "p3"].map((id) => status(doc, id))).toEqual(["ACTIVE", "ACTIVE", "ACTIVE"]);
    expect(status(doc, "n")).toBe("PENDING");
  });

  it("전원 동의여야 다음 단계로 간다", () => {
    let doc = submitted(parallel("all"));
    doc = ok(run(doc, "p2", { kind: "agree" }, "u2")).doc;
    doc = ok(run(doc, "p1", { kind: "agree" }, "u1")).doc;
    expect(status(doc, "n")).toBe("PENDING");
    doc = ok(run(doc, "p3", { kind: "agree" }, "u3")).doc;
    expect(status(doc, "n")).toBe("ACTIVE");
  });

  it("N명 동의: 정족수가 차면 남은 단계는 SKIPPED가 되고 다음으로 간다", () => {
    let doc = submitted(parallel(2));
    doc = ok(run(doc, "p1", { kind: "agree" }, "u1")).doc;
    expect(status(doc, "n")).toBe("PENDING");
    doc = ok(run(doc, "p3", { kind: "agree" }, "u3")).doc;
    expect(status(doc, "p2")).toBe("SKIPPED");
    expect(status(doc, "n")).toBe("ACTIVE");
    // 건너뛴 단계는 더 처리할 수 없다
    expect(run(doc, "p2", { kind: "agree" }, "u2")).toMatchObject({
      ok: false,
      code: "step_not_active",
    });
  });

  it("병렬 그룹 중 한 명이 반려(부동의)하면 문서가 반려된다", () => {
    const doc = submitted(parallel("all"));
    const r = ok(run(doc, "p2", { kind: "disagree", comment: "반대" }, "u2"));
    expect(r.doc.status).toBe("REJECTED");
  });

  it("부서 대상(여러 처리자 중 1명)은 먼저 처리한 사람만 반영된다", () => {
    let doc = submitted([step("d", 1, "approve", ["u1", "u2"])]);
    const first = ok(run(doc, "d", { kind: "approve" }, "u2"));
    doc = first.doc;
    expect(first.record?.actorId).toBe("u2");
    expect(doc.status).toBe("COMPLETED");
    expect(run(doc, "d", { kind: "approve" }, "u1")).toMatchObject({ ok: false });
  });
});

describe("보류 (APV-040)", () => {
  it("보류하면 문서가 ON_HOLD, 해제하면 다시 IN_PROGRESS", () => {
    let doc = submitted([step("a", 1, "approve", "u1"), step("b", 2, "approve", "u2")]);
    const held = ok(run(doc, "a", { kind: "hold", comment: "확인 중" }, "u1"));
    doc = held.doc;
    expect(doc.status).toBe("ON_HOLD");
    expect(status(doc, "a")).toBe("HELD");
    // 보류 중에는 승인할 수 없다
    expect(run(doc, "a", { kind: "approve" }, "u1")).toMatchObject({ ok: false });
    const released = ok(run(doc, "a", { kind: "release" }, "u1"));
    expect(released.doc.status).toBe("IN_PROGRESS");
    expect(status(released.doc, "a")).toBe("ACTIVE");
  });

  it("처리자 또는 결재 관리자만 해제할 수 있다", () => {
    const held = ok(
      run(submitted([step("a", 1, "approve", "u1")]), "a", { kind: "hold" }, "u1"),
    ).doc;
    expect(run(held, "a", { kind: "release" }, "u9")).toMatchObject({
      ok: false,
      code: "not_assignee",
    });
    const admin = act(
      held,
      "a",
      { kind: "release" },
      { membershipId: "u9", isApprovalAdmin: true },
      noDelegates,
    );
    expect(admin.ok).toBe(true);
  });

  it("병렬 그룹에서 다른 단계가 보류돼도 문서는 ON_HOLD, 다른 단계는 처리하지 못한다", () => {
    const doc = submitted([step("p1", 1, "agree", "u1"), step("p2", 1, "agree", "u2")]);
    const held = ok(run(doc, "p1", { kind: "hold" }, "u1")).doc;
    expect(run(held, "p2", { kind: "agree" }, "u2")).toMatchObject({
      ok: false,
      code: "invalid_state",
    });
  });
});

describe("전결 (APV-040)", () => {
  const line = () => [
    step("a", 1, "approve", "u1"),
    step("b", 2, "approve", "u2", { canFinalize: true }),
    step("c", 3, "approve", "u3"),
    step("p", 9, "post", "u4"),
  ];

  it("전결 권한자가 전결하면 이후 결재 단계는 SKIPPED, 문서는 완료, 후결은 POST_PENDING", () => {
    let doc = submitted(line());
    doc = ok(run(doc, "a", { kind: "approve" }, "u1")).doc;
    const r = ok(run(doc, "b", { kind: "finalize" }, "u2"));
    expect(r.doc.status).toBe("COMPLETED");
    expect(status(r.doc, "b")).toBe("APPROVED");
    expect(status(r.doc, "c")).toBe("SKIPPED");
    expect(status(r.doc, "p")).toBe("POST_PENDING");
    expect(r.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["completed", "post_pending"]),
    );
  });

  it("전결 권한이 없는 단계는 전결할 수 없다", () => {
    let doc = submitted(line());
    expect(run(doc, "a", { kind: "finalize" }, "u1")).toMatchObject({
      ok: false,
      code: "action_not_allowed",
    });
    doc = ok(run(doc, "a", { kind: "approve" }, "u1")).doc;
    expect(ok(run(doc, "b", { kind: "approve" }, "u2")).doc.status).toBe("IN_PROGRESS");
  });

  it("대결자는 전결할 수 없다", () => {
    const ctx: EngineContext = {
      now,
      decideDelegate: (id): DelegateDecision =>
        id === "u2" ? { kind: "delegate", delegateId: "d2" } : { kind: "none" },
    };
    let doc = submitted(line(), undefined, ctx);
    doc = ok(run(doc, "a", { kind: "approve" }, "u1", ctx)).doc;
    expect(run(doc, "b", { kind: "finalize" }, "d2", ctx)).toMatchObject({
      ok: false,
      code: "action_not_allowed",
    });
    expect(run(doc, "b", { kind: "approve" }, "d2", ctx).ok).toBe(true);
  });
});

describe("후결 (APV-030)", () => {
  it("완료를 막지 않고, 완료 후 후결 승인만 허용한다", () => {
    let doc = submitted([step("a", 1, "approve", "u1"), step("p", 5, "post", "u2")]);
    const done = ok(run(doc, "a", { kind: "approve" }, "u1"));
    doc = done.doc;
    expect(doc.status).toBe("COMPLETED");
    expect(status(doc, "p")).toBe("POST_PENDING");
    expect(run(doc, "p", { kind: "approve" }, "u2")).toMatchObject({ ok: false });
    const post = ok(run(doc, "p", { kind: "post_approve", comment: "확인" }, "u2"));
    expect(status(post.doc, "p")).toBe("POST_APPROVED");
    expect(post.doc.status).toBe("COMPLETED");
    expect(post.events).toContainEqual({ type: "post_approved", docId: "doc1", stepId: "p" });
    // 처리자만
    expect(run(doc, "p", { kind: "post_approve" }, "u1")).toMatchObject({
      ok: false,
      code: "not_assignee",
    });
  });

  it("완료 전에는 후결을 처리할 수 없다", () => {
    const doc = submitted([step("a", 1, "approve", "u1"), step("p", 5, "post", "u2")]);
    expect(run(doc, "p", { kind: "post_approve" }, "u2")).toMatchObject({ ok: false });
  });
});

describe("감사 단계 (AUD-001·002)", () => {
  const line = () => [step("x", 1, "audit", "au"), step("z", 2, "approve", "u2")];

  it("감사 승인으로 진행하고, 감사 반려로 반려한다", () => {
    const ok1 = ok(run(submitted(line()), "x", { kind: "audit_approve" }, "au"));
    expect(status(ok1.doc, "z")).toBe("ACTIVE");
    const rej = ok(
      run(submitted(line()), "x", { kind: "audit_reject", comment: "증빙 부족" }, "au"),
    );
    expect(rej.doc.status).toBe("REJECTED");
  });

  it("반려 불가 옵션이면 의견만 남기고 진행한다 (승인·반려 행위는 거부)", () => {
    const doc = submitted(line(), { auditCanReject: false });
    expect(run(doc, "x", { kind: "audit_reject", comment: "x" }, "au")).toMatchObject({
      code: "action_not_allowed",
    });
    expect(run(doc, "x", { kind: "audit_approve" }, "au")).toMatchObject({
      code: "action_not_allowed",
    });
    const r = ok(run(doc, "x", { kind: "audit_comment", comment: "특이사항 없음" }, "au"));
    expect(status(r.doc, "z")).toBe("ACTIVE");
  });

  it("반려 가능 옵션이어도 의견만 남기고 진행할 수 있다", () => {
    const r = ok(run(submitted(line()), "x", { kind: "audit_comment", comment: "참고" }, "au"));
    expect(status(r.doc, "x")).toBe("APPROVED");
  });
});

describe("대결 (APV-050·051·053)", () => {
  const delegating: EngineContext = {
    now,
    decideDelegate: (id): DelegateDecision =>
      id === "u1" ? { kind: "delegate", delegateId: "d1" } : { kind: "none" },
  };

  it("활성화 때 대결자가 정해지고, 대결자가 처리하면 DELEGATED·on_behalf_of가 기록된다", () => {
    const doc = submitted([step("a", 1, "approve", "u1")], undefined, delegating);
    expect(doc.steps[0]?.delegates).toEqual({ u1: "d1" });
    const r = ok(run(doc, "a", { kind: "approve" }, "d1", delegating));
    expect(status(r.doc, "a")).toBe("DELEGATED");
    expect(r.doc.status).toBe("COMPLETED");
    expect(r.record).toMatchObject({ actorId: "d1", onBehalfOf: "u1" });
  });

  it("원 결재자도 처리할 수 있고, 먼저 처리한 쪽만 반영된다", () => {
    const doc = submitted([step("a", 1, "approve", "u1")], undefined, delegating);
    const own = ok(run(doc, "a", { kind: "approve" }, "u1", delegating));
    expect(status(own.doc, "a")).toBe("APPROVED");
    expect(own.record?.onBehalfOf).toBeNull();
    expect(run(own.doc, "a", { kind: "approve" }, "d1", delegating)).toMatchObject({ ok: false });
  });

  it("대결자도 부재이면 대결이 성립하지 않고 알림 이벤트가 난다 (연쇄 위임 금지)", () => {
    const chained: EngineContext = {
      now,
      decideDelegate: (id): DelegateDecision =>
        id === "u1" ? { kind: "unavailable", delegateId: "d1" } : { kind: "none" },
    };
    const r = ok(submit(draft([step("a", 1, "approve", "u1")]), chained));
    expect(r.doc.steps[0]?.delegates).toEqual({});
    expect(r.events).toContainEqual({
      type: "delegate_unavailable",
      docId: "doc1",
      stepId: "a",
      assigneeId: "u1",
      delegateId: "d1",
    });
    expect(run(r.doc, "a", { kind: "approve" }, "d1", chained)).toMatchObject({
      ok: false,
      code: "not_assignee",
    });
  });

  it("기안자와 같은 사람이 대결자로 정해져도 기안자 본인이 아니면 그대로 처리 가능", () => {
    const doc = submitted([step("a", 1, "approve", "u1")], undefined, delegating);
    expect(run(doc, "a", { kind: "approve" }, "stranger", delegating)).toMatchObject({
      ok: false,
      code: "not_assignee",
    });
  });
});

describe("회수 (APV-017)", () => {
  const line = () => [step("a", 1, "approve", "u1"), step("b", 2, "approve", "u2")];

  it("첫 처리 전에는 기안자가 회수할 수 있고, 다시 초안으로 수정한다", () => {
    const doc = submitted(line());
    const r = ok(withdraw(doc, "drafter", noDelegates));
    expect(r.doc.status).toBe("WITHDRAWN");
    expect(r.doc.steps.every((s) => s.status === "PENDING")).toBe(true);
    expect(r.record).toMatchObject({ action: "withdraw", actorId: "drafter" });
    const reopened = ok(reopenDraft(r.doc));
    expect(reopened.doc.status).toBe("DRAFT");
    // 다시 상신 가능
    expect(submit(reopened.doc, noDelegates).ok).toBe(true);
  });

  it("누군가 처리한 뒤에는 회수할 수 없다", () => {
    let doc = submitted(line());
    doc = ok(run(doc, "a", { kind: "approve" }, "u1")).doc;
    expect(withdraw(doc, "drafter", noDelegates)).toMatchObject({
      ok: false,
      code: "cannot_withdraw",
    });
  });

  it("보류된 문서도 회수할 수 없고, 기안자가 아니면 회수할 수 없다", () => {
    const held = ok(run(submitted(line()), "a", { kind: "hold" }, "u1")).doc;
    expect(withdraw(held, "drafter", noDelegates)).toMatchObject({ ok: false });
    expect(withdraw(submitted(line()), "u1", noDelegates)).toMatchObject({
      ok: false,
      code: "not_assignee",
    });
  });
});

describe("재기안·취소·보관 (APV-019, 5.4.1)", () => {
  it("반려된 문서에서 재기안 초안을 만들면 단계가 초기화되고 원문과 연결된다", () => {
    let doc = submitted([step("a", 1, "approve", "u1")]);
    doc = ok(run(doc, "a", { kind: "reject", comment: "x" }, "u1")).doc;
    const seed = redraftSeed(doc, (old) => `new-${old}`);
    expect(seed).toMatchObject({ ok: true });
    if (seed.ok) {
      expect(seed.draft.status).toBe("DRAFT");
      expect(seed.draft.steps[0]).toMatchObject({ id: "new-a", status: "PENDING", version: 0 });
      expect(seed.supersedes).toBe("doc1");
    }
  });

  it("반려되지 않은 문서는 재기안할 수 없다", () => {
    expect(redraftSeed(submitted([step("a", 1, "approve", "u1")]), (id) => id).ok).toBe(false);
  });

  it("완료 문서는 취소·보관 상태로만 바뀐다", () => {
    const done = ok(
      run(submitted([step("a", 1, "approve", "u1")]), "a", { kind: "approve" }, "u1"),
    ).doc;
    expect(transitionDocument(done, "CANCELED").ok).toBe(true);
    expect(transitionDocument(done, "ARCHIVED").ok).toBe(true);
    expect(transitionDocument(done, "DRAFT")).toMatchObject({ ok: false, code: "invalid_state" });
  });
});

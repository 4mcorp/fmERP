import { describe, expect, it } from "vitest";
import type { ApprovalEvent } from "../../../packages/core/src/approval-types";
import {
  type NotificationContext,
  notificationPath,
  notificationsForEvent,
} from "../src/domain/notification-rules";

const ctx: NotificationContext = {
  docTitle: "비밀 프로젝트 지출 결의서",
  drafterId: "drafter",
  drafterName: "김기안",
};
const recipients = (e: ApprovalEvent, c = ctx) =>
  notificationsForEvent(e, c).map((n) => `${n.kind}:${n.recipientId}`);

describe("결재 이벤트 → 알림 (NTF-001)", () => {
  it("결재 차례가 되면 결재자와 대결자에게 요청 알림, 중복은 한 번", () => {
    const e: ApprovalEvent = {
      type: "step_activated",
      docId: "d",
      stepId: "s",
      assigneeIds: ["a", "b"],
      delegateIds: ["c", "a"],
    };
    expect(recipients(e)).toEqual([
      "approval_requested:a",
      "approval_requested:b",
      "approval_requested:c",
    ]);
  });

  it("외부 채널 문구에는 문서 제목·의견이 없고 인앱 제목에는 제목이 있다", () => {
    const events: ApprovalEvent[] = [
      { type: "step_activated", docId: "d", stepId: "s", assigneeIds: ["a"], delegateIds: [] },
      { type: "rejected", docId: "d", stepId: "s", comment: "금액이 너무 큽니다 1234" },
      { type: "completed", docId: "d" },
      { type: "line_changed", docId: "d", added: ["n"], removed: [], reason: "급여 기밀 사유" },
      { type: "post_pending", docId: "d", stepId: "s", assigneeIds: ["a"] },
      { type: "held", docId: "d", stepId: "s" },
      { type: "delegate_unavailable", docId: "d", stepId: "s", assigneeId: "a", delegateId: "z" },
    ];
    for (const e of events) {
      for (const n of notificationsForEvent(e, ctx)) {
        expect(n.external).not.toContain("비밀 프로젝트");
        expect(n.external).not.toContain("금액이");
        expect(n.external).not.toContain("급여 기밀");
        expect(n.title).toContain("비밀 프로젝트");
        expect(n.documentId).toBe("d");
      }
    }
  });

  it("반려·보류는 기안자에게, 반려 의견은 인앱 본문에도 싣지 않는다", () => {
    const e: ApprovalEvent = { type: "rejected", docId: "d", stepId: "s", comment: "비공개 의견" };
    const [n, ...rest] = notificationsForEvent(e, ctx);
    expect(rest).toHaveLength(0);
    expect(n).toMatchObject({ recipientId: "drafter", kind: "approval_rejected" });
    expect(n?.body).not.toContain("비공개 의견");
    expect(recipients({ type: "held", docId: "d", stepId: "s" })).toEqual([
      "approval_held:drafter",
    ]);
  });

  it("재활성화는 컨텍스트의 단계 처리자에게, 모르는 단계면 아무도 없다", () => {
    const e: ApprovalEvent = { type: "reactivated", docId: "d", stepId: "s1" };
    expect(recipients(e, { ...ctx, stepAssignees: { s1: ["p", "q"] } })).toEqual([
      "approval_requested:p",
      "approval_requested:q",
    ]);
    expect(recipients(e)).toEqual([]);
  });

  it("완료는 기안자와 문서 수신자에게, 기안자가 수신자에 있어도 한 번만", () => {
    expect(
      recipients(
        { type: "completed", docId: "d" },
        { ...ctx, recipientIds: ["r1", "drafter", "r1"] },
      ),
    ).toEqual(["approval_completed:drafter", "document_received:r1"]);
  });

  it("회수는 결재 차례였던 사람들에게 알린다 (기안자 본인 제외)", () => {
    expect(
      recipients(
        { type: "withdrawn", docId: "d" },
        { ...ctx, activeAssigneeIds: ["a", "drafter"] },
      ),
    ).toEqual(["approval_withdrawn:a"]);
  });

  it("대결 불가는 기안자와 원 결재자에게, 결재선 변경은 기안자와 추가된 사람에게", () => {
    expect(
      recipients({
        type: "delegate_unavailable",
        docId: "d",
        stepId: "s",
        assigneeId: "a",
        delegateId: "z",
      }),
    ).toEqual(["delegate_unavailable:drafter", "delegate_unavailable:a"]);
    expect(
      recipients({
        type: "line_changed",
        docId: "d",
        added: ["n", "drafter"],
        removed: ["x"],
        reason: "r",
      }),
    ).toEqual(["line_changed:drafter", "line_changed:n"]);
  });

  it("상신·보류 해제·후결 승인은 알림이 없다", () => {
    for (const e of [
      { type: "submitted", docId: "d" },
      { type: "released", docId: "d", stepId: "s" },
      { type: "post_approved", docId: "d", stepId: "s" },
    ] as ApprovalEvent[]) {
      expect(notificationsForEvent(e, ctx)).toEqual([]);
    }
  });
});

describe("알림 이동 경로", () => {
  it("문서가 있으면 문서로, 없으면 종류별 화면으로", () => {
    expect(notificationPath("approval_requested", "doc-1")).toBe("/approval/doc-1");
    expect(notificationPath("audit_review_due", null)).toBe("/admin/audit");
    expect(notificationPath("backup_problem", null)).toBe("/system/backups");
    expect(notificationPath("line_changed", null)).toBe("/");
  });
});

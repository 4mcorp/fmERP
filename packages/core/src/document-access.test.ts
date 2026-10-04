import { describe, expect, it } from "vitest";
import {
  canDistribute,
  canReceive,
  canViewDocument,
  type DocumentViewFacts,
  type Recipient,
} from "./document-access";

const base = (over: Partial<DocumentViewFacts> = {}): DocumentViewFacts => ({
  viewerMembershipId: "viewer",
  viewerDepartmentIds: ["dept-x"],
  hasReadAll: false,
  drafterMembershipId: "drafter",
  status: "COMPLETED",
  securityLevel: "normal",
  stepParticipantIds: ["approver"],
  ccVisibleFrom: "submit",
  recipients: [],
  ...over,
});

const dept = (over: Partial<Recipient> = {}): Recipient => ({
  kind: "receive",
  target: { type: "department", id: "dept-x" },
  receivedByMembershipId: null,
  assigneeMembershipId: null,
  departmentHeadMembershipId: null,
  ...over,
});

describe("canViewDocument (PERM-003)", () => {
  it("기안자는 어떤 상태에서도 본다", () => {
    for (const status of ["DRAFT", "IN_PROGRESS", "COMPLETED", "WITHDRAWN"] as const) {
      expect(canViewDocument(base({ viewerMembershipId: "drafter", status }))).toBe(true);
    }
  });

  it("초안은 기안자만 본다 (결재선 참여자·감사인·참조자도 못 본다)", () => {
    const facts = base({
      status: "DRAFT",
      viewerMembershipId: "approver",
      hasReadAll: true,
      recipients: [{ ...dept({ kind: "cc", target: { type: "member", id: "approver" } }) }],
    });
    expect(canViewDocument(facts)).toBe(false);
  });

  it("결재선 참여자(대결자 포함)는 상신 후 본다", () => {
    expect(canViewDocument(base({ viewerMembershipId: "approver", status: "IN_PROGRESS" }))).toBe(
      true,
    );
    expect(canViewDocument(base({ stepParticipantIds: ["approver", "viewer"] }))).toBe(true);
  });

  it("관계없는 사람은 본문을 보지 못한다", () => {
    expect(canViewDocument(base())).toBe(false);
  });

  it("관리자 권한만으로는 본다고 할 수 없다 (read_all이 없으면 거부)", () => {
    expect(canViewDocument(base({ hasReadAll: false }))).toBe(false);
  });

  it("read_all(소유자·감사인)은 초안을 제외한 모든 문서를 본다", () => {
    expect(canViewDocument(base({ hasReadAll: true, status: "IN_PROGRESS" }))).toBe(true);
    expect(canViewDocument(base({ hasReadAll: true, status: "REJECTED" }))).toBe(true);
    expect(canViewDocument(base({ hasReadAll: true, status: "DRAFT" }))).toBe(false);
  });

  describe("참조 (APV-073)", () => {
    const cc = (over: Partial<Recipient> = {}): Recipient =>
      dept({ kind: "cc", target: { type: "member", id: "viewer" }, ...over });

    it("상신 즉시 설정이면 진행 중에도 본다", () => {
      const facts = base({ status: "IN_PROGRESS", recipients: [cc()] });
      expect(canViewDocument(facts)).toBe(true);
    });

    it("완료 시 설정이면 완료 전에는 못 보고 완료 후에 본다", () => {
      expect(
        canViewDocument(
          base({ status: "IN_PROGRESS", ccVisibleFrom: "complete", recipients: [cc()] }),
        ),
      ).toBe(false);
      expect(
        canViewDocument(
          base({ status: "COMPLETED", ccVisibleFrom: "complete", recipients: [cc()] }),
        ),
      ).toBe(true);
    });

    it("부서 참조는 그 부서원이 본다", () => {
      const facts = base({
        status: "IN_PROGRESS",
        recipients: [cc({ target: { type: "department", id: "dept-x" } })],
      });
      expect(canViewDocument(facts)).toBe(true);
      expect(canViewDocument({ ...facts, viewerDepartmentIds: ["other"] })).toBe(false);
    });

    it("회수·반려된 문서의 참조자는 보지 못한다", () => {
      for (const status of ["WITHDRAWN", "REJECTED", "CANCELED"] as const) {
        expect(canViewDocument(base({ status, recipients: [cc()] }))).toBe(false);
      }
    });
  });

  describe("공람 (APV-072)", () => {
    const circulate = (over: Partial<Recipient> = {}): Recipient =>
      dept({ kind: "circulate", target: { type: "member", id: "viewer" }, ...over });

    it("완료 후 대상자만 본다", () => {
      expect(canViewDocument(base({ recipients: [circulate()] }))).toBe(true);
      expect(canViewDocument(base({ status: "IN_PROGRESS", recipients: [circulate()] }))).toBe(
        false,
      );
    });

    it("부서 대상은 부서원이 본다", () => {
      const facts = base({
        recipients: [circulate({ target: { type: "department", id: "dept-x" } })],
      });
      expect(canViewDocument(facts)).toBe(true);
    });
  });

  describe("수신 (APV-070)", () => {
    it("접수 전에는 수신 부서원이 보지 못한다", () => {
      expect(canViewDocument(base({ recipients: [dept()] }))).toBe(false);
    });

    it("접수 담당자(부서장)는 완료 후 접수 전에도 문서를 열어 볼 수 있다", () => {
      const head = dept({ departmentHeadMembershipId: "viewer" });
      expect(canViewDocument(base({ recipients: [head] }))).toBe(true);
      // 대외비 이상이어도 접수 담당자는 본다 (본 뒤에 접수 여부를 정한다)
      expect(canViewDocument(base({ securityLevel: "secret", recipients: [head] }))).toBe(true);
      // 완료 전에는 아직 전달되지 않았으므로 볼 수 없다
      expect(canViewDocument(base({ status: "IN_PROGRESS", recipients: [head] }))).toBe(false);
    });

    it("지정 담당자가 있으면 부서장이 아니라 그 사람만 접수 전에 본다", () => {
      const r = dept({ assigneeMembershipId: "clerk", departmentHeadMembershipId: "viewer" });
      expect(canViewDocument(base({ recipients: [r] }))).toBe(false);
      expect(canViewDocument(base({ viewerMembershipId: "clerk", recipients: [r] }))).toBe(true);
    });

    it("이미 접수됐다면 접수 담당자 자격만으로는 더 넓게 보이지 않는다", () => {
      // 일반 문서는 부서원 규칙, 대외비 이상은 접수자만
      const received = dept({
        receivedByMembershipId: "head",
        departmentHeadMembershipId: "viewer",
      });
      expect(canViewDocument(base({ securityLevel: "confidential", recipients: [received] }))).toBe(
        false,
      );
    });

    it("접수 후에는 수신 부서원 전체가 본다 (일반 문서)", () => {
      const facts = base({ recipients: [dept({ receivedByMembershipId: "head" })] });
      expect(canViewDocument(facts)).toBe(true);
    });

    it("다른 부서원은 접수 후에도 보지 못한다", () => {
      const facts = base({
        viewerDepartmentIds: ["other"],
        recipients: [dept({ receivedByMembershipId: "head" })],
      });
      expect(canViewDocument(facts)).toBe(false);
    });

    it("대외비 이상은 접수자만 본다", () => {
      for (const securityLevel of ["confidential", "secret"] as const) {
        const received = dept({ receivedByMembershipId: "head" });
        expect(canViewDocument(base({ securityLevel, recipients: [received] }))).toBe(false);
        expect(
          canViewDocument(
            base({ securityLevel, viewerMembershipId: "head", recipients: [received] }),
          ),
        ).toBe(true);
      }
    });

    it("완료 전에는 접수 기록이 있어도 보지 못한다", () => {
      const facts = base({
        status: "IN_PROGRESS",
        recipients: [dept({ receivedByMembershipId: "head" })],
      });
      expect(canViewDocument(facts)).toBe(false);
    });
  });
});

describe("canReceive (접수)", () => {
  const head = "head";

  it("지정 담당자가 없으면 부서장이 접수한다", () => {
    expect(
      canReceive({
        status: "COMPLETED",
        recipient: dept(),
        viewerMembershipId: head,
        departmentHeadMembershipId: head,
      }),
    ).toBe(true);
  });

  it("지정 담당자가 있으면 그 사람만 접수하고 부서장은 못 한다", () => {
    const recipient = dept({ assigneeMembershipId: "clerk" });
    const common = { status: "COMPLETED" as const, recipient, departmentHeadMembershipId: head };
    expect(canReceive({ ...common, viewerMembershipId: "clerk" })).toBe(true);
    expect(canReceive({ ...common, viewerMembershipId: head })).toBe(false);
  });

  it("완료 전, 이미 접수됨, 수신 유형이 아니면 접수할 수 없다", () => {
    const common = { viewerMembershipId: head, departmentHeadMembershipId: head };
    expect(canReceive({ ...common, status: "IN_PROGRESS", recipient: dept() })).toBe(false);
    expect(
      canReceive({
        ...common,
        status: "COMPLETED",
        recipient: dept({ receivedByMembershipId: "head" }),
      }),
    ).toBe(false);
    expect(
      canReceive({
        ...common,
        status: "COMPLETED",
        recipient: dept({ kind: "circulate" }),
      }),
    ).toBe(false);
  });
});

describe("canDistribute (배부)", () => {
  const received = dept({ receivedByMembershipId: "head" });

  it("접수자가 같은 부서의 구성원에게 배부한다", () => {
    expect(
      canDistribute({
        recipient: received,
        viewerMembershipId: "head",
        targetDepartmentIds: ["dept-x"],
      }),
    ).toBe(true);
  });

  it("접수자가 아니거나 다른 부서 구성원이면 배부할 수 없다", () => {
    expect(
      canDistribute({
        recipient: received,
        viewerMembershipId: "someone",
        targetDepartmentIds: ["dept-x"],
      }),
    ).toBe(false);
    expect(
      canDistribute({
        recipient: received,
        viewerMembershipId: "head",
        targetDepartmentIds: ["other"],
      }),
    ).toBe(false);
  });

  it("접수 전에는 배부할 수 없다", () => {
    expect(
      canDistribute({
        recipient: dept(),
        viewerMembershipId: "head",
        targetDepartmentIds: ["dept-x"],
      }),
    ).toBe(false);
  });
});

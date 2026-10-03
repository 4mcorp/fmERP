import type { DocStatus } from "./approval-types";

/** 문서 열람 판정 (PRD PERM-003)과 수신 접수·배부 규칙 (APV-070). DB·프레임워크를 모르는 순수 함수다. */

export type SecurityLevel = "normal" | "confidential" | "secret";

export type RecipientKind = "cc" | "receive" | "circulate";

export type RecipientTarget = { type: "member"; id: string } | { type: "department"; id: string };

export interface Recipient {
  kind: RecipientKind;
  target: RecipientTarget;
  /** 수신: 접수한 구성원 (접수 전이면 null) */
  receivedByMembershipId: string | null;
  /** 수신: 지정 담당자. 없으면 수신 부서장이 접수한다 */
  assigneeMembershipId: string | null;
}

export interface DocumentViewFacts {
  viewerMembershipId: string;
  /** 열람자가 속한 부서(상위 부서 포함 여부는 호출자가 정한다) */
  viewerDepartmentIds: readonly string[];
  /** `document.read_all` 권한 (소유자·감사인, 문서가 속한 범위 기준). 관리자 권한과 무관하다 */
  hasReadAll: boolean;
  drafterMembershipId: string;
  status: DocStatus;
  securityLevel: SecurityLevel;
  /** 결재선에 걸린 구성원: 처리자와 대결자 */
  stepParticipantIds: readonly string[];
  /** 참조자가 보기 시작하는 시점 (양식 설정) */
  ccVisibleFrom: "submit" | "complete";
  recipients: readonly Recipient[];
}

const matches = (target: RecipientTarget, facts: DocumentViewFacts): boolean =>
  target.type === "member"
    ? target.id === facts.viewerMembershipId
    : facts.viewerDepartmentIds.includes(target.id);

/** 상신된 적이 있고 진행이 이어지거나 끝난 상태 (회수·반려·취소는 참조·공람 대상이 아니다) */
const LIVE: readonly DocStatus[] = ["IN_PROGRESS", "ON_HOLD", "COMPLETED", "ARCHIVED"];

export function canViewDocument(facts: DocumentViewFacts): boolean {
  if (facts.viewerMembershipId === facts.drafterMembershipId) return true;
  // 초안은 기안자 외에 누구도 볼 수 없다
  if (facts.status === "DRAFT") return false;
  if (facts.hasReadAll) return true;
  if (facts.stepParticipantIds.includes(facts.viewerMembershipId)) return true;

  const completed = facts.status === "COMPLETED" || facts.status === "ARCHIVED";
  return facts.recipients.some((r) => {
    switch (r.kind) {
      case "cc":
        if (!LIVE.includes(facts.status) || !matches(r.target, facts)) return false;
        return facts.ccVisibleFrom === "submit" || completed;
      case "circulate":
        return completed && matches(r.target, facts);
      case "receive": {
        if (!completed || r.receivedByMembershipId === null) return false;
        if (facts.securityLevel !== "normal") {
          return r.receivedByMembershipId === facts.viewerMembershipId;
        }
        return matches(r.target, facts);
      }
      default:
        return false;
    }
  });
}

/** 수신 접수: 완료된 문서의 아직 접수되지 않은 수신 건을 지정 담당자(없으면 부서장)가 접수한다 */
export function canReceive(input: {
  status: DocStatus;
  recipient: Recipient;
  viewerMembershipId: string;
  departmentHeadMembershipId: string | null;
}): boolean {
  const { status, recipient: r } = input;
  if (r.kind !== "receive" || r.receivedByMembershipId !== null) return false;
  if (status !== "COMPLETED" && status !== "ARCHIVED") return false;
  const receiver = r.assigneeMembershipId ?? input.departmentHeadMembershipId;
  return receiver !== null && receiver === input.viewerMembershipId;
}

/** 배부: 접수자가 수신 부서 안의 구성원에게 넘긴다 */
export function canDistribute(input: {
  recipient: Recipient;
  viewerMembershipId: string;
  targetDepartmentIds: readonly string[];
}): boolean {
  const { recipient: r } = input;
  if (r.kind !== "receive" || r.receivedByMembershipId !== input.viewerMembershipId) return false;
  return r.target.type === "department" && input.targetDepartmentIds.includes(r.target.id);
}

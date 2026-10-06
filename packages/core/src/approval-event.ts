/**
 * 결재 이벤트 계약. 결재 엔진이 만들고(`approval_event` outbox에 저장), 알림 같은 소비 기능이 읽는다.
 * 소비 기능이 결재 코드를 import하지 않도록 형식을 여기에 한 번만 선언한다.
 * (공통 소유 파일이다. packages/core가 해체되면 shared/contracts로 옮긴다.)
 * 이벤트 종류를 바꾸면 이 타입을 읽는 모든 기능이 타입 검사로 드러난다.
 */
export type ApprovalEvent =
  | { type: "submitted"; docId: string }
  | {
      type: "step_activated";
      docId: string;
      stepId: string;
      assigneeIds: string[];
      delegateIds: string[];
    }
  | {
      type: "delegate_unavailable";
      docId: string;
      stepId: string;
      assigneeId: string;
      delegateId: string;
    }
  | { type: "reactivated"; docId: string; stepId: string }
  | { type: "held"; docId: string; stepId: string }
  | { type: "released"; docId: string; stepId: string }
  | { type: "withdrawn"; docId: string; activeAssigneeIds?: string[] }
  | { type: "rejected"; docId: string; stepId: string; comment: string }
  | { type: "completed"; docId: string }
  | { type: "post_pending"; docId: string; stepId: string; assigneeIds: string[] }
  | { type: "post_approved"; docId: string; stepId: string }
  | { type: "line_changed"; docId: string; added: string[]; removed: string[]; reason: string };

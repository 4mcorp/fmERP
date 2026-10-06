/**
 * 결재 이벤트 → 알림 수신자·문구 (PRD NTF-001, M8 plan). 순수 함수라 DB·네트워크를 모른다.
 *
 * 인앱 알림(`title`·`body`)에는 문서 제목을 쓸 수 있지만, 외부 채널(텔레그램)로 나가는 `external`에는
 * 문서 제목·내용·의견을 넣지 않는다. 고객 데이터가 외부 서비스로 나가지 않게 하기 위함이다.
 * 구성원 id는 membership id다.
 */
import type { ApprovalEvent } from "@fmerp/shared/domain/approval-event";

/** DB의 `notification.kind`(packages/db/src/schema/notification.ts)와 같은 목록이다. 바꾸면 양쪽을 함께 고친다 */
export const NOTIFICATION_KINDS = [
  "approval_requested",
  "approval_rejected",
  "approval_completed",
  "approval_withdrawn",
  "approval_held",
  "post_approval_requested",
  "delegate_unavailable",
  "line_changed",
  "document_received",
  "audit_review_due",
  "backup_problem",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationContext {
  docTitle: string;
  drafterId: string;
  drafterName: string;
  /** 단계 id → 처리자 목록. 재활성화(`reactivated`)처럼 이벤트에 처리자가 없을 때 쓴다 */
  stepAssignees?: Record<string, string[]>;
  /** 회수 이벤트에 목록이 없을 때(이전 형식)를 위한 대체값. 보통은 이벤트의 `activeAssigneeIds`를 쓴다 */
  activeAssigneeIds?: string[];
  /** 완료 시 참조·수신·공람으로 도착하는 사람들 (M5 문서 수신자) */
  recipientIds?: string[];
}

export interface NotificationDraft {
  recipientId: string;
  kind: NotificationKind;
  documentId: string;
  /** 인앱 알림 문구 */
  title: string;
  body: string;
  /** 외부 채널 문구. 문서 제목·내용·의견이 없다 */
  external: string;
}

const unique = (ids: readonly string[]) => [...new Set(ids)];

/** 한 이벤트가 만드는 알림 목록. 같은 사람에게 같은 종류는 한 번만 만든다 */
export function notificationsForEvent(
  event: ApprovalEvent,
  ctx: NotificationContext,
): NotificationDraft[] {
  const make = (
    recipients: readonly string[],
    kind: NotificationKind,
    title: string,
    body: string,
    external: string,
  ): NotificationDraft[] =>
    unique(recipients).map((recipientId) => ({
      recipientId,
      kind,
      documentId: event.docId,
      title,
      body,
      external,
    }));
  const by = `기안자 ${ctx.drafterName}`;

  switch (event.type) {
    case "step_activated":
      return make(
        [...event.assigneeIds, ...event.delegateIds],
        "approval_requested",
        `결재 요청: ${ctx.docTitle}`,
        by,
        `결재 요청 1건 · ${by}`,
      );
    case "reactivated":
      return make(
        ctx.stepAssignees?.[event.stepId] ?? [],
        "approval_requested",
        `다시 결재 요청: ${ctx.docTitle}`,
        `${by} · 이전 단계 반려로 다시 결재 차례가 되었습니다`,
        `결재 요청 1건(재요청) · ${by}`,
      );
    case "rejected":
      return make(
        [ctx.drafterId],
        "approval_rejected",
        `반려됨: ${ctx.docTitle}`,
        "결재 의견을 확인하세요",
        "기안한 문서가 반려되었습니다",
      );
    case "completed":
      return [
        ...make(
          [ctx.drafterId],
          "approval_completed",
          `결재 완료: ${ctx.docTitle}`,
          "최종 승인되었습니다",
          "기안한 문서의 결재가 완료되었습니다",
        ),
        ...make(
          (ctx.recipientIds ?? []).filter((id) => id !== ctx.drafterId),
          "document_received",
          `문서 도착: ${ctx.docTitle}`,
          by,
          `문서 1건이 도착했습니다 · ${by}`,
        ),
      ];
    case "withdrawn":
      return make(
        (event.activeAssigneeIds ?? ctx.activeAssigneeIds ?? []).filter(
          (id) => id !== ctx.drafterId,
        ),
        "approval_withdrawn",
        `회수됨: ${ctx.docTitle}`,
        `${by}가 문서를 회수했습니다`,
        `결재 요청이 회수되었습니다 · ${by}`,
      );
    case "held":
      return make(
        [ctx.drafterId],
        "approval_held",
        `보류됨: ${ctx.docTitle}`,
        "결재가 보류되었습니다",
        "기안한 문서가 보류되었습니다",
      );
    case "post_pending":
      return make(
        event.assigneeIds,
        "post_approval_requested",
        `후결 요청: ${ctx.docTitle}`,
        by,
        `후결 요청 1건 · ${by}`,
      );
    case "delegate_unavailable":
      return make(
        [ctx.drafterId, event.assigneeId],
        "delegate_unavailable",
        `대결자를 정할 수 없음: ${ctx.docTitle}`,
        "대결자도 부재라 원래 결재자가 처리해야 합니다",
        "대결자를 정할 수 없는 결재가 있습니다",
      );
    case "line_changed":
      return make(
        [ctx.drafterId, ...event.added],
        "line_changed",
        `결재선 변경: ${ctx.docTitle}`,
        `사유: ${event.reason}`,
        "결재선이 변경되었습니다",
      );
    default:
      // submitted·released·post_approved는 알림이 없다 (다음 차례 알림이 따로 생긴다)
      return [];
  }
}

/** 알림을 눌렀을 때 이동할 앱 안 경로 (알림 센터와 텔레그램 링크가 함께 쓴다) */
export function notificationPath(kind: NotificationKind, documentId: string | null): string {
  if (documentId) return `/approval/${documentId}`;
  if (kind === "audit_review_due") return "/admin/audit";
  if (kind === "backup_problem") return "/system/backups";
  return "/";
}

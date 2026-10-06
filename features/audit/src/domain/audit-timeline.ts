// 문서 이력 타임라인 병합 (PRD AUD-011). 데이터 출처가 셋이라 같은 사건이 겹칠 수 있어, 정본 규칙으로 중복을 없앤다.
//  - 단계 처리(승인·반려·보류·전결·동의·감사 등): `approval_action`이 정본 → 감사 로그의 같은 행위는 제외
//  - 완료: `approval_event`의 `completed`
//  - 그 밖의 문서 행위(작성·상신·회수·결재선 변경·다운로드·인쇄·공람 등): 감사 로그

interface TimelineAction {
  at: Date;
  kind: string;
  actor: string;
  onBehalfOf: string | null;
  comment: string | null;
}
interface TimelineEvent {
  at: Date;
  type: string;
}
interface TimelineLog {
  at: Date;
  action: string;
  actor: string | null;
  reason: string | null;
  ip: string | null;
}
export interface TimelineInput {
  actions: TimelineAction[];
  events: TimelineEvent[];
  logs: TimelineLog[];
  /** 감사인·소유자의 열람 기록(`document.audit_view`)을 넣을지 */
  includeViews: boolean;
  /** 접속지(IP)를 담을지. 감사 권한자에게만 보인다 */
  includeIp: boolean;
}
export interface TimelineItem {
  at: Date;
  kind: string;
  label: string;
  actor: string | null;
  onBehalfOf: string | null;
  detail: string | null;
  ip: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  approve: "승인",
  reject: "반려",
  hold: "보류",
  finalize: "전결",
  agree: "합의",
  disagree: "이의",
  audit_approve: "감사 승인",
  audit_reject: "감사 반려",
  audit_comment: "감사 의견",
  post_approve: "후결 승인",
};

/** 감사 로그에서 가져오는 행위(`approval.` 접두 제외한 이름)와 표시 이름 */
const LOG_LABELS: Record<string, string> = {
  "approval.create": "작성",
  "approval.submit": "상신",
  "approval.withdraw": "회수",
  "approval.reopen": "회수 문서 수정",
  "approval.redraft": "재기안",
  "approval.replace_line": "결재선 교체",
  "approval.line_change": "결재선 변경",
  "approval.transfer": "결재자 이관",
  "document.download_pdf": "PDF 내려받기",
  "document.download_package": "패키지 내려받기",
  "document.print": "인쇄",
  "document.circulate": "공람 지정",
  "document.receive": "수신 접수",
  "document.distribute": "배부",
  "document.audit_view": "감사 열람",
};

/**
 * 감사 로그에 같이 남지만 타임라인에는 넣지 않는 행위.
 * `approval.comment`는 기안자 전용 의견의 존재(누가·언제)를 다른 열람자에게 알릴 수 있어 뺀다.
 */
const LOG_SKIPPED = new Set(["approval.save_draft", "document.package_ready", "approval.comment"]);

/** 사유가 인사 사정(휴직·퇴사 인수인계 등)일 수 있어 감사 권한자에게만 보이는 행위 */
const LOG_DETAIL_RESTRICTED = new Set(["approval.transfer"]);

/** `approval_action`이 정본인 단계 처리 행위의 감사 로그 이름 */
const STEP_LOG_ACTIONS = new Set(Object.keys(ACTION_LABELS).map((k) => `approval.${k}`));

export function buildTimeline(input: TimelineInput): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const a of input.actions) {
    items.push({
      at: a.at,
      kind: a.kind,
      label: ACTION_LABELS[a.kind] ?? a.kind,
      actor: a.actor,
      onBehalfOf: a.onBehalfOf,
      detail: a.comment,
      ip: null,
    });
  }
  for (const e of input.events) {
    if (e.type !== "completed") continue;
    items.push({
      at: e.at,
      kind: "completed",
      label: "완료",
      actor: null,
      onBehalfOf: null,
      detail: null,
      ip: null,
    });
  }
  for (const l of input.logs) {
    if (STEP_LOG_ACTIONS.has(l.action) || LOG_SKIPPED.has(l.action)) continue;
    if (l.action === "document.audit_view" && !input.includeViews) continue;
    items.push({
      at: l.at,
      kind: l.action.replace(/^(approval|document)\./, ""),
      label: LOG_LABELS[l.action] ?? l.action,
      actor: l.actor,
      onBehalfOf: null,
      detail: LOG_DETAIL_RESTRICTED.has(l.action) && !input.includeIp ? null : l.reason,
      ip: input.includeIp ? l.ip : null,
    });
  }

  // 안정 정렬: 같은 시각이면 만들어진 순서(작성·처리·완료·로그)를 유지한다
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.at.getTime() - b.item.at.getTime() || a.index - b.index)
    .map((x) => x.item);
}

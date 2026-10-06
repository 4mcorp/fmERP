"use client";

import { api } from "@fmerp/shared/lib/api";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

export interface AuditLogRow {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  actorName: string | null;
  onBehalfOfName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  subjectName: string | null;
  diff: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  result: string;
  reason: string | null;
  /** 문서 내용을 볼 권한이 없어 제목·의견을 가렸는지 */
  masked: boolean;
}

export interface AuditLogPage {
  items: AuditLogRow[];
  nextCursor: string | null;
}

export interface AuditReviewMonth {
  period: string;
  state: "pending" | "done" | "abnormal";
  last: {
    id: string;
    reviewedAt: string;
    memo: string | null;
    abnormal: boolean;
    abnormalNote: string | null;
    reviewerName: string;
  } | null;
}

export interface AuditReviewOverview {
  targetPeriod: string;
  overdue: boolean;
  months: AuditReviewMonth[];
}

export interface TimelineItem {
  at: string;
  kind: string;
  label: string;
  actor: string | null;
  onBehalfOf: string | null;
  detail: string | null;
  ip: string | null;
}

/** 감사 로그 행위 이름의 화면 표시. 없는 행위는 코드를 그대로 보인다 */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "auth.login": "로그인",
  "auth.logout": "로그아웃",
  "auth.session_expired": "세션 만료",
  "role.grant": "권한 부여",
  "role.revoke": "권한 말소",
  "approval.create": "결재 작성",
  "approval.submit": "상신",
  "approval.withdraw": "회수",
  "approval.line_change": "결재선 변경",
  "document.download_pdf": "PDF 내려받기",
  "document.download_package": "패키지 내려받기",
  "document.print": "인쇄",
  "document.export": "목록 내보내기",
  "document.audit_view": "감사 열람",
  "audit.view_log": "감사 로그 조회",
  "audit.review": "접속 기록 점검",
};

export const AUDIT_ACTION_GROUPS: { value: string; label: string }[] = [
  { value: "auth.", label: "로그인·세션" },
  { value: "approval.", label: "결재" },
  { value: "document.", label: "문서 열람·내려받기" },
  { value: "attachment.", label: "첨부" },
  { value: "role.", label: "권한" },
  { value: "member.", label: "구성원" },
  { value: "department.", label: "부서" },
  { value: "form.", label: "양식" },
  { value: "audit.", label: "감사" },
];

/** 감사 로그 조회 (AUD-025). `query`는 `from=...&action=...` 형태 */
export const useAuditLogs = (query: string, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: ["audit-logs", query],
    queryFn: ({ pageParam }) =>
      api<AuditLogPage>(
        `/api/audit-logs?${query}&limit=50${pageParam ? `&cursor=${pageParam}` : ""}`,
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });

/** 월간 접속 기록 점검 현황 (AUD-026) */
export const useAuditReviews = (enabled: boolean) =>
  useQuery({
    queryKey: ["audit-reviews"],
    queryFn: () => api<AuditReviewOverview>("/api/audit-logs/reviews"),
    enabled,
  });

/** 문서 이력 타임라인 (AUD-011) */
export const useTimeline = (documentId: string, enabled: boolean) =>
  useQuery({
    queryKey: ["timeline", documentId],
    queryFn: () => api<TimelineItem[]>(`/api/approvals/${documentId}/timeline`),
    enabled,
  });

/** 행위자 필터 목록: 구성원 목록 API에서 필요한 필드만 쓴다 (구성원 화면의 타입을 import하지 않는다) */
export const useAuditActors = () =>
  useQuery({
    queryKey: ["members"],
    queryFn: () => api<{ userId: string; name: string }[]>("/api/account/members"),
  });

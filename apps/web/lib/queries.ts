"use client";

import { api } from "@fmerp/shared/lib/api";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type {
  AccountExports,
  ApprovalView,
  AttachmentInfo,
  AuditLogPage,
  AuditReviewOverview,
  Business,
  Capabilities,
  CommentInfo,
  CurrentAccount,
  Department,
  DocumentPage,
  FormDetail,
  FormSummary,
  MasterItem,
  Me,
  Member,
  MineItem,
  OrgChart,
  PendingItem,
  RecipientInfo,
  SystemBackups,
  TimelineItem,
} from "./types";

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me") });

/** 활성 회사 정보. 활성 회사가 없으면 요청하지 않는다 */
export const useCurrentAccount = (enabled: boolean) =>
  useQuery({
    queryKey: ["account"],
    queryFn: () => api<CurrentAccount>("/api/account"),
    enabled,
  });

/** 내 관리 권한 요약. 메뉴 노출에만 쓰고 실제 권한은 서버가 판정한다 */
export const useCapabilities = (enabled: boolean) =>
  useQuery({
    queryKey: ["capabilities"],
    queryFn: () => api<Capabilities>("/api/account/capabilities"),
    enabled,
  });

export const useOrgChart = () =>
  useQuery({ queryKey: ["org-chart"], queryFn: () => api<OrgChart>("/api/org-chart") });

export const useBusinesses = () =>
  useQuery({ queryKey: ["businesses"], queryFn: () => api<Business[]>("/api/businesses") });

export const useDepartments = () =>
  useQuery({ queryKey: ["departments"], queryFn: () => api<Department[]>("/api/departments") });

export const useMembers = () =>
  useQuery({ queryKey: ["members"], queryFn: () => api<Member[]>("/api/account/members") });

export const usePositions = () =>
  useQuery({ queryKey: ["positions"], queryFn: () => api<MasterItem[]>("/api/positions") });

export const useDuties = () =>
  useQuery({ queryKey: ["duties"], queryFn: () => api<MasterItem[]>("/api/duties") });

// ===== 전자결재 (M4) =====
export const useForms = (all = false) =>
  useQuery({
    queryKey: ["forms", all],
    queryFn: () => api<FormSummary[]>(`/api/forms${all ? "?all=true" : ""}`),
  });

export const useFormDetail = (id: string | undefined) =>
  useQuery({
    queryKey: ["form", id],
    queryFn: () => api<FormDetail>(`/api/forms/${id}`),
    enabled: Boolean(id),
  });

export const useApproval = (id: string | undefined) =>
  useQuery({
    queryKey: ["approval", id],
    queryFn: () => api<ApprovalView>(`/api/approvals/${id}`),
    enabled: Boolean(id),
  });

export const useApprovalBody = (id: string | undefined, revision?: number) =>
  useQuery({
    queryKey: ["approval-body", id, revision],
    queryFn: () =>
      api<{ revision: number; body: Record<string, unknown> }>(`/api/approvals/${id}/body`),
    enabled: Boolean(id),
  });

export const useAttachments = (id: string | undefined) =>
  useQuery({
    queryKey: ["approval-attachments", id],
    queryFn: () => api<AttachmentInfo[]>(`/api/approvals/${id}/attachments`),
    enabled: Boolean(id),
  });

export const useComments = (id: string | undefined) =>
  useQuery({
    queryKey: ["approval-comments", id],
    queryFn: () => api<CommentInfo[]>(`/api/approvals/${id}/comments`),
    enabled: Boolean(id),
  });

export const usePending = (enabled = true) =>
  useQuery({
    queryKey: ["inbox-pending"],
    queryFn: () => api<PendingItem[]>("/api/inbox/pending"),
    enabled,
  });

/** 완료 PDF·패키지 생성 상태. 만드는 중이면 몇 초마다 다시 확인한다 (APV-063) */
export const usePackageStatus = (id: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ["approval-package", id],
    queryFn: () =>
      api<{ status: "NONE" | "PENDING" | "READY" | "FAILED"; readyAt: string | null }>(
        `/api/approvals/${id}/package`,
      ),
    enabled: Boolean(id) && enabled,
    refetchInterval: (q) => (q.state.data?.status === "PENDING" ? 4000 : false),
  });

/** 참조·수신·공람 대상과 열람·접수·배부 상태 */
export const useRecipients = (id: string | undefined) =>
  useQuery({
    queryKey: ["approval-recipients", id],
    queryFn: () => api<RecipientInfo[]>(`/api/approvals/${id}/recipients`),
    enabled: Boolean(id),
  });

export const useMine = () =>
  useQuery({ queryKey: ["inbox-mine"], queryFn: () => api<MineItem[]>("/api/inbox/mine") });

/** 문서함 목록. 커서로 이어서 가져온다 (APV-080·081) */
export const useMailbox = (box: string, enabled = true) =>
  useInfiniteQuery({
    enabled,
    queryKey: ["mailbox", box],
    queryFn: ({ pageParam }) =>
      api<DocumentPage>(`/api/mailbox/${box}?limit=30${pageParam ? `&cursor=${pageParam}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

/** 문서 검색 (APV-082). `query`는 `q=...&status=...` 형태이며 비어 있으면 요청하지 않는다 */
export const useSearch = (query: string) =>
  useInfiniteQuery({
    queryKey: ["search", query],
    queryFn: ({ pageParam }) =>
      api<DocumentPage>(`/api/search?${query}&limit=30${pageParam ? `&cursor=${pageParam}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: query !== "",
  });

// ===== 감사 (M6) =====

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

// ===== 덤프·내보내기 (M7) =====

/** 내가 시스템 관리자인지 (DB 덤프 메뉴 노출용. 아니어도 200) */
export const useSystemMe = () =>
  useQuery({
    queryKey: ["system-me"],
    queryFn: () => api<{ systemAdmin: boolean }>("/api/system/me"),
  });

const ACTIVE = new Set(["QUEUED", "RUNNING"]);

/** DB 덤프 이력. 대기·실행 중인 덤프가 있으면 5초마다 다시 읽는다 */
export const useSystemBackups = (enabled: boolean) =>
  useQuery({
    queryKey: ["system-backups"],
    queryFn: () => api<SystemBackups>("/api/system/backups"),
    enabled,
    refetchInterval: (q) => (q.state.data?.items.some((i) => ACTIVE.has(i.status)) ? 5000 : false),
  });

/** 계정 내보내기 이력. 만드는 중인 것이 있으면 5초마다 다시 읽는다 */
export const useAccountExports = (enabled: boolean) =>
  useQuery({
    queryKey: ["account-exports"],
    queryFn: () => api<AccountExports>("/api/account/exports"),
    enabled,
    refetchInterval: (q) => (q.state.data?.items.some((i) => ACTIVE.has(i.status)) ? 5000 : false),
  });

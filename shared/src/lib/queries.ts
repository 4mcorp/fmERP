"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type {
  ApprovalView,
  AttachmentInfo,
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

// ===== 덤프·내보내기 (M7) =====

/** 내가 시스템 관리자인지 (DB 덤프 메뉴 노출용. 아니어도 200) */
export const useSystemMe = () =>
  useQuery({
    queryKey: ["system-me"],
    queryFn: () => api<{ systemAdmin: boolean }>("/api/system/me"),
  });

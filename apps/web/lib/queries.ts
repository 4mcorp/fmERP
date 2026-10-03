"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type {
  ApprovalView,
  AttachmentInfo,
  Business,
  Capabilities,
  CommentInfo,
  CurrentAccount,
  Department,
  FormDetail,
  FormSummary,
  MasterItem,
  Me,
  Member,
  MineItem,
  OrgChart,
  PendingItem,
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

export const useMine = () =>
  useQuery({ queryKey: ["inbox-mine"], queryFn: () => api<MineItem[]>("/api/inbox/mine") });

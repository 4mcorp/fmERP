"use client";

import { api } from "@fmerp/shared/lib/api";
import type {
  ApprovalView,
  AttachmentInfo,
  CommentInfo,
  DocumentPage,
  FormDetail,
  RecipientInfo,
} from "@fmerp/shared/lib/types";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

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
/** 참조·수신·공람 대상과 열람·접수·배부 상태 */
export const useRecipients = (id: string | undefined) =>
  useQuery({
    queryKey: ["approval-recipients", id],
    queryFn: () => api<RecipientInfo[]>(`/api/approvals/${id}/recipients`),
    enabled: Boolean(id),
  });
export const useFormDetail = (id: string | undefined) =>
  useQuery({
    queryKey: ["form", id],
    queryFn: () => api<FormDetail>(`/api/forms/${id}`),
    enabled: Boolean(id),
  });
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

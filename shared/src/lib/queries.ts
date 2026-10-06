"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type {
  Business,
  Capabilities,
  CurrentAccount,
  Department,
  FormSummary,
  Me,
  Member,
  MineItem,
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

export const useBusinesses = () =>
  useQuery({ queryKey: ["businesses"], queryFn: () => api<Business[]>("/api/businesses") });

export const useDepartments = () =>
  useQuery({ queryKey: ["departments"], queryFn: () => api<Department[]>("/api/departments") });

export const useMembers = () =>
  useQuery({ queryKey: ["members"], queryFn: () => api<Member[]>("/api/account/members") });

// ===== 전자결재 (M4) =====
export const useForms = (all = false) =>
  useQuery({
    queryKey: ["forms", all],
    queryFn: () => api<FormSummary[]>(`/api/forms${all ? "?all=true" : ""}`),
  });

export const usePending = (enabled = true) =>
  useQuery({
    queryKey: ["inbox-pending"],
    queryFn: () => api<PendingItem[]>("/api/inbox/pending"),
    enabled,
  });

export const useMine = () =>
  useQuery({ queryKey: ["inbox-mine"], queryFn: () => api<MineItem[]>("/api/inbox/mine") });

// ===== 덤프·내보내기 (M7) =====

/** 내가 시스템 관리자인지 (DB 덤프 메뉴 노출용. 아니어도 200) */
export const useSystemMe = () =>
  useQuery({
    queryKey: ["system-me"],
    queryFn: () => api<{ systemAdmin: boolean }>("/api/system/me"),
  });

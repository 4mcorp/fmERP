"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type {
  Business,
  Capabilities,
  CurrentAccount,
  Department,
  MasterItem,
  Me,
  Member,
  OrgChart,
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

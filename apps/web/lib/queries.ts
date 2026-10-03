"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { CurrentAccount, Me } from "./types";

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me") });

/** 활성 회사 정보. 활성 회사가 없으면 요청하지 않는다 */
export const useCurrentAccount = (enabled: boolean) =>
  useQuery({
    queryKey: ["account"],
    queryFn: () => api<CurrentAccount>("/api/account"),
    enabled,
  });

"use client";

import { api } from "@fmerp/shared/lib/api";
import { useQuery } from "@tanstack/react-query";

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

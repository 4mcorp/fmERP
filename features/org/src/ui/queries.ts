"use client";

import { api } from "@fmerp/shared/lib/api";
import type { MasterItem, OrgChart } from "@fmerp/shared/lib/types";
import { useQuery } from "@tanstack/react-query";

export const useOrgChart = () =>
  useQuery({ queryKey: ["org-chart"], queryFn: () => api<OrgChart>("/api/org-chart") });

export const usePositions = () =>
  useQuery({ queryKey: ["positions"], queryFn: () => api<MasterItem[]>("/api/positions") });

export const useDuties = () =>
  useQuery({ queryKey: ["duties"], queryFn: () => api<MasterItem[]>("/api/duties") });

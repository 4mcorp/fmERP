"use client";

import { api } from "@fmerp/shared/lib/api";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  documentId: string | null;
  href: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationItem[];
  nextCursor: string | null;
}

export interface MyTelegram {
  enabled: boolean;
  linked: boolean;
}

export type ReceiverMode = "polling" | "webhook";

export interface SystemTelegram {
  configured: {
    botToken: boolean;
    botUsername: boolean;
    webhookSecret: boolean;
    webhookReady: boolean;
    publicBaseUrl: string;
  };
  mode: ReceiverMode;
  applied: { mode: ReceiverMode | null; error: string | null; at: string } | null;
  webhook: { url: string; pendingUpdateCount: number; lastErrorMessage: string | null } | null;
}

/** 읽지 않은 알림 수 (헤더 배지). 30초마다 다시 읽는다 */
export const useUnreadCount = (enabled: boolean) =>
  useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => api<{ count: number }>("/api/notifications/unread-count"),
    enabled,
    refetchInterval: 30_000,
  });

export const useNotifications = (unreadOnly: boolean) =>
  useInfiniteQuery({
    queryKey: ["notifications", "list", unreadOnly],
    queryFn: ({ pageParam }) =>
      api<NotificationPage>(
        `/api/notifications?limit=30&unread=${unreadOnly}${pageParam ? `&cursor=${pageParam}` : ""}`,
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useMyTelegram = () =>
  useQuery({ queryKey: ["my-telegram"], queryFn: () => api<MyTelegram>("/api/me/telegram") });

export const useSystemTelegram = (enabled: boolean) =>
  useQuery({
    queryKey: ["system-telegram"],
    queryFn: () => api<SystemTelegram>("/api/system/telegram"),
    enabled,
  });

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { useNotifications } from "@/lib/queries";
import { formatDateTime } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 알림 센터 (PRD NTF-002). 알림을 누르면 읽음으로 표시하고 해당 문서로 이동한다 */
export default function NotificationsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, isPending, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useNotifications(unreadOnly);
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });

  async function open(id: string, href: string, read: boolean) {
    try {
      if (!read) await api(`/api/notifications/${id}/read`, { method: "POST" });
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
    if (href !== "/") router.push(href);
  }

  async function readAll() {
    try {
      await api("/api/notifications/read-all", { method: "POST" });
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 text-2xl font-semibold">알림</h1>
        <Button
          variant={unreadOnly ? "default" : "outline"}
          size="sm"
          aria-pressed={unreadOnly}
          onClick={() => setUnreadOnly((v) => !v)}
        >
          안 읽은 알림만
        </Button>
        <Button variant="outline" size="sm" onClick={readAll}>
          <CheckCheck aria-hidden />
          모두 읽음
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(error)}
        </p>
      )}
      {isPending ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          불러오는 중…
        </p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
          <Bell className="size-8" aria-hidden />
          <p>{unreadOnly ? "읽지 않은 알림이 없습니다." : "아직 알림이 없습니다."}</p>
        </div>
      ) : (
        <ul className="divide-y rounded-md border">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => open(n.id, n.href, n.readAt !== null)}
                className={cn(
                  "flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-muted/50 focus-visible:bg-muted/50",
                  n.readAt === null && "bg-muted/30",
                )}
              >
                <span className="flex items-center gap-2">
                  {n.readAt === null && (
                    <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />
                  )}
                  <span className={cn("truncate", n.readAt === null && "font-medium")}>
                    {n.title}
                  </span>
                  {n.readAt === null && <span className="sr-only">(읽지 않음)</span>}
                </span>
                {n.body && <span className="truncate text-sm text-muted-foreground">{n.body}</span>}
                <span className="text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {hasNextPage && (
        <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          더 보기
        </Button>
      )}
      <p className="text-sm text-muted-foreground">
        텔레그램으로도 받으려면{" "}
        <Link href="/me" className="underline">
          내 정보
        </Link>
        에서 연결하세요.
      </p>
    </div>
  );
}

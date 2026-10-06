"use client";

import { api, errorMessage } from "@fmerp/shared/lib/api";
import { cn } from "@fmerp/shared/lib/utils";
import { Button } from "@fmerp/shared/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useNotifications } from "@/lib/queries";
import { formatDateTime } from "@/lib/types";

/** 이동할 곳이 있으면 링크(새 탭 열기 지원), 없으면(홈으로만 가는 알림) 읽음 처리만 하는 버튼 */
function Row({
  href,
  onActivate,
  className,
  children,
}: {
  href: string;
  onActivate: () => void;
  className: string;
  children: ReactNode;
}) {
  return href === "/" ? (
    <button type="button" onClick={onActivate} className={className}>
      {children}
    </button>
  ) : (
    <Link href={href} onClick={onActivate} className={className}>
      {children}
    </Link>
  );
}

/** 알림 센터 (PRD NTF-002). 알림을 누르면 읽음으로 표시하고 해당 문서로 이동한다 */
export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, isPending, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useNotifications(unreadOnly);
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });

  /** 알림을 읽음으로 표시한다. 이동은 링크가 맡으므로 기다리지 않고, 실패하면 알린다 */
  async function markRead(id: string, read: boolean) {
    if (read) return;
    try {
      await api(`/api/notifications/${id}/read`, { method: "POST" });
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function readAll() {
    try {
      await api("/api/notifications/read-all", { method: "POST" });
      await refresh();
      toast.success("모든 알림을 읽음으로 표시했습니다");
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
              <Row
                href={n.href}
                onActivate={() => markRead(n.id, n.readAt !== null)}
                className={cn(
                  "flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-muted/50 focus-visible:bg-muted/50",
                  n.readAt === null && "bg-muted/30",
                )}
              >
                <span className="flex items-center gap-2">
                  {n.readAt === null && (
                    <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />
                  )}
                  <span className={cn("min-w-0 truncate", n.readAt === null && "font-medium")}>
                    {n.title}
                  </span>
                  {n.readAt === null && <span className="sr-only">(읽지 않음)</span>}
                </span>
                {n.body && (
                  <span className="min-w-0 truncate text-sm text-muted-foreground">{n.body}</span>
                )}
                <span className="text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</span>
              </Row>
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

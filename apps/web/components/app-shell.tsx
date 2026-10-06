"use client";

import { useUnreadCount } from "@fmerp/feature-notification/ui/queries";
import { adminEntry } from "@fmerp/shared/lib/admin-nav";
import { api, errorMessage } from "@fmerp/shared/lib/api";
import { cn } from "@fmerp/shared/lib/utils";
import { Button } from "@fmerp/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@fmerp/shared/ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Building2,
  CalendarOff,
  ChevronDown,
  DatabaseBackup,
  LogOut,
  Network,
  Plus,
  Send,
  Settings,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { clearLocalDrafts } from "@/lib/local-drafts";
import { useCapabilities, useCurrentAccount, useMe, usePending, useSystemMe } from "@/lib/queries";
import { ROLE_LABEL } from "@/lib/types";

export function AppShell({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const { data: account } = useCurrentAccount(Boolean(me?.activeAccountId));
  const activeAccounts = me?.accounts.filter((a) => a.status === "active") ?? [];
  const { data: caps } = useCapabilities(Boolean(me?.activeAccountId));
  const pathname = usePathname();
  const { data: pending } = usePending(Boolean(me?.activeAccountId));
  const { data: unread } = useUnreadCount(Boolean(me?.activeAccountId));
  const adminLink = adminEntry(caps);
  // DB 덤프 메뉴는 시스템 관리자에게만 보인다 (실제 권한은 서버가 판정한다)
  const { data: systemMe } = useSystemMe();

  async function switchAccount(accountId: string) {
    try {
      await api("/api/accounts/active", { method: "POST", body: { accountId } });
      await queryClient.invalidateQueries();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function signOut() {
    // 이 브라우저에 남은 기안 로컬 사본을 지운다 (BAK-001)
    await clearLocalDrafts();
    await fetch("/api/auth/sign-out", { method: "POST" });
    window.location.href = me?.devTestLogin ? "/dev-login" : "/login";
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
          <Link href="/" className="font-semibold">
            4mERP
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="max-w-48 gap-1" aria-label="회사 전환">
                <Building2 className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{account?.name ?? "회사 선택"}</span>
                <ChevronDown className="size-4 shrink-0" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>회사 전환</DropdownMenuLabel>
              {activeAccounts.map((a) => (
                <DropdownMenuItem
                  key={a.accountId}
                  onSelect={() => switchAccount(a.accountId)}
                  aria-current={a.accountId === me?.activeAccountId ? "true" : undefined}
                >
                  <span className="flex-1">{a.name}</span>
                  <span className="text-xs text-muted-foreground">{ROLE_LABEL[a.role]}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/onboarding">
                  <Plus className="size-4" aria-hidden />새 회사 만들기·초대 합류
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex-1" />

          {me?.activeAccountId && (
            <Button variant="ghost" size="sm" className="relative" asChild>
              <Link
                href="/notifications"
                aria-label={unread?.count ? `알림, 읽지 않은 알림 ${unread.count}건` : "알림"}
              >
                <Bell className="size-4" aria-hidden />
                {unread?.count ? (
                  <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground">
                    {unread.count > 99 ? "99+" : unread.count}
                  </span>
                ) : null}
              </Link>
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1" aria-label="사용자 메뉴">
                <UserRound className="size-4" aria-hidden />
                <span className="hidden sm:inline">{me?.name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="font-normal">
                <div className="font-medium">{me?.name}</div>
                <div className="text-xs text-muted-foreground">{me?.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/me">
                  <UserRound className="size-4" aria-hidden />내 정보
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/me/absence">
                  <CalendarOff className="size-4" aria-hidden />
                  부재 설정
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/org">
                  <Network className="size-4" aria-hidden />
                  조직도
                </Link>
              </DropdownMenuItem>
              {adminLink && (
                <DropdownMenuItem asChild>
                  <Link href={adminLink}>
                    <Settings className="size-4" aria-hidden />
                    관리 콘솔
                  </Link>
                </DropdownMenuItem>
              )}
              {systemMe?.systemAdmin && (
                <>
                  <DropdownMenuItem asChild>
                    <Link href="/system/backups">
                      <DatabaseBackup className="size-4" aria-hidden />
                      시스템 덤프
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/system/telegram">
                      <Send className="size-4" aria-hidden />
                      텔레그램 수신 방식
                    </Link>
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={signOut}>
                <LogOut className="size-4" aria-hidden />
                로그아웃
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {me?.activeAccountId && (
          <nav
            aria-label="전자결재"
            className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2"
          >
            {[
              { href: "/approval/new", label: "새 결재" },
              { href: "/approval/pending", label: "결재 대기", count: pending?.length },
              { href: "/approval/mine", label: "기안함" },
              { href: "/mailbox", label: "문서함" },
              { href: "/search", label: "검색" },
              { href: "/org", label: "조직도" },
            ].map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={pathname.startsWith(n.href) ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm hover:bg-muted",
                  pathname.startsWith(n.href) && "bg-muted font-medium",
                )}
              >
                {n.label}
                {n.count ? (
                  <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                    {n.count}
                    <span className="sr-only">건</span>
                  </span>
                ) : null}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-5xl p-4 sm:p-6">{children}</main>
    </div>
  );
}

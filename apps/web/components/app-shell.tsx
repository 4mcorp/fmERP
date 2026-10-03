"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronDown, LogOut, Network, Plus, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { adminEntry } from "@/lib/admin-nav";
import { api, errorMessage } from "@/lib/api";
import { useCapabilities, useCurrentAccount, useMe } from "@/lib/queries";
import { ROLE_LABEL } from "@/lib/types";

export function AppShell({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const { data: account } = useCurrentAccount(Boolean(me?.activeAccountId));
  const activeAccounts = me?.accounts.filter((a) => a.status === "active") ?? [];
  const { data: caps } = useCapabilities(Boolean(me?.activeAccountId));
  const adminLink = adminEntry(caps);

  async function switchAccount(accountId: string) {
    try {
      await api("/api/accounts/active", { method: "POST", body: { accountId } });
      await queryClient.invalidateQueries();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function signOut() {
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
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={signOut}>
                <LogOut className="size-4" aria-hidden />
                로그아웃
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4 sm:p-6">{children}</main>
    </div>
  );
}

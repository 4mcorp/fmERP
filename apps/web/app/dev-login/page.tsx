"use client";

import { api, errorMessage } from "@fmerp/shared/lib/api";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type DevTestUser, ROLE_LABEL } from "@/lib/types";

const ACCOUNT_LABEL: Record<string, string> = { main: "포엠테스트", other: "다른회사" };

/** 개발·테스트 전용 로그인 화면. 운영에서는 API가 404를 돌려주므로 목록이 비어 있다 (M1 계획 1장) */
export default function DevLoginPage() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: users, isError } = useQuery({
    queryKey: ["dev-test-accounts"],
    queryFn: () => api<DevTestUser[]>("/api/dev/test-accounts"),
  });

  async function login(email: string) {
    setPending(email);
    setError(null);
    try {
      await api("/api/dev/login", { method: "POST", body: { email } });
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next?.startsWith("/") ? next : "/";
    } catch (e) {
      setError(errorMessage(e));
      setPending(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">4mERP 테스트 로그인</h1>
        <p className="text-sm text-muted-foreground">
          개발·테스트 환경 전용입니다. 소셜 로그인(Google·Naver)은 마지막 단계(M9)에서 연결합니다.
        </p>
      </header>

      {isError && (
        <p role="alert" className="text-sm text-destructive">
          테스트 로그인이 꺼져 있습니다. 개발 환경의 DEV_TEST_LOGIN 설정을 확인하세요.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <ul className="grid gap-3">
        {users?.map((u) => (
          <li key={u.email}>
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-base">{u.name}</CardTitle>
                  <CardDescription>{u.email}</CardDescription>
                </div>
                <Button
                  onClick={() => login(u.email)}
                  disabled={pending !== null}
                  aria-label={`${u.name}(으)로 로그인`}
                >
                  {pending === u.email ? "로그인 중…" : "로그인"}
                </Button>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">{u.purpose}</span>
                {u.memberships.map((m) => (
                  <Badge key={m.account} variant="secondary">
                    {ACCOUNT_LABEL[m.account] ?? m.account} · {ROLE_LABEL[m.role]}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </main>
  );
}

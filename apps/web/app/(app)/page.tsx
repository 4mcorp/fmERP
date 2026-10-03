"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentAccount, useMe } from "@/lib/queries";
import { ROLE_LABEL } from "@/lib/types";

export default function HomePage() {
  const router = useRouter();
  const { data: me } = useMe();
  const { data: account } = useCurrentAccount(Boolean(me?.activeAccountId));

  // 소속 회사가 없으면 회사 만들기·초대 합류 화면으로 보낸다 (AUTH-005)
  useEffect(() => {
    if (me && !me.activeAccountId) router.replace("/onboarding");
  }, [me, router]);

  if (!me || !account) return null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{account.name}</h1>
        <p className="text-muted-foreground">
          {me.name}님 · {ROLE_LABEL[account.myRole]}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/me">
          <Card className="h-full transition-colors hover:bg-muted/50">
            <CardHeader>
              <CardTitle className="text-base">내 정보</CardTitle>
              <CardDescription>서명·도장, 결재 PIN, 세션, 로그인 이력</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        {(account.myRole === "owner" || account.myRole === "admin") && (
          <Link href="/admin/members">
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle className="text-base">구성원 관리</CardTitle>
                <CardDescription>초대 링크, 구성원 비활성화</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
      </div>
    </div>
  );
}

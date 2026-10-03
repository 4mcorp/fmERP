"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";

/** 초대 링크 전체 또는 토큰만 붙여넣어도 토큰을 꺼낸다 */
function extractToken(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/\/invite\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? trimmed;
}

/** 새 회사 만들기(AUTH-005 ①) 또는 초대로 합류(AUTH-005 ②) */
export default function OnboardingPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [saving, setSaving] = useState(false);

  async function createCompany(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/accounts", { method: "POST", body: { name } });
      await queryClient.invalidateQueries();
      toast.success("회사를 만들었습니다. 사업자 등록은 조직 관리에서 이어서 진행합니다");
      router.push("/");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  function joinByInvite(e: FormEvent) {
    e.preventDefault();
    const token = extractToken(invite);
    if (token) router.push(`/invite/${token}`);
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>새 회사 만들기</CardTitle>
          <CardDescription>만든 사람이 소유자가 됩니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={createCompany} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="company-name">회사 이름</Label>
              <Input
                id="company-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 포엠(주)"
                minLength={2}
                maxLength={100}
                required
              />
            </div>
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? "만드는 중…" : "회사 만들기"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>초대로 합류</CardTitle>
          <CardDescription>받은 초대 링크를 붙여넣으세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={joinByInvite} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="invite-link">초대 링크</Label>
              <Input
                id="invite-link"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                placeholder="https://…/invite/…"
                required
              />
            </div>
            <Button type="submit" variant="secondary" className="w-full">
              초대 확인
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

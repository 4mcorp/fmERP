"use client";

import { api } from "@fmerp/shared/lib/api";
import { useCurrentAccount } from "@fmerp/shared/lib/queries";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import { useReauth } from "@fmerp/shared/ui/use-reauth";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { EnrollmentLinkBox } from "./enrollment-link";

/** 관리자 사전 등록: 이메일·이름으로 구성원을 만들고 passkey 등록 링크를 한 번 보여 준다 (PK2, PK1d API). 결재 PIN 재인증 */
export function PreRegisterCard() {
  const queryClient = useQueryClient();
  const { data: account } = useCurrentAccount(true);
  const { run, dialog } = useReauth();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ token: string; expiresAt: string } | null>(null);

  if (account?.myRole !== "owner" && account?.myRole !== "admin") return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { email: email.trim(), name: name.trim() };
    setBusy(true);
    await run(async () => {
      const created = await api<{
        userId: string;
        created: boolean;
        token: string;
        expiresAt: string;
      }>("/api/account/members", { method: "POST", body });
      setIssued({ token: created.token, expiresAt: created.expiresAt });
      setEmail("");
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["members"] });
    });
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">구성원 사전 등록</CardTitle>
        <CardDescription>
          사용자를 먼저 등록하고 passkey 등록 링크를 만듭니다. 링크로 이 기기에 passkey를 만들면
          바로 로그인됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="pre-email">이메일</Label>
            <Input
              id="pre-email"
              type="email"
              value={email}
              maxLength={254}
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pre-name">이름</Label>
            <Input
              id="pre-name"
              value={name}
              maxLength={100}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "등록하는 중…" : "사전 등록"}
          </Button>
        </form>
        {issued && <EnrollmentLinkBox token={issued.token} expiresAt={issued.expiresAt} />}
      </CardContent>
      {dialog}
    </Card>
  );
}

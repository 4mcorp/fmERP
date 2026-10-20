"use client";

import { api } from "@fmerp/shared/lib/api";
import { useCurrentAccount } from "@fmerp/shared/lib/queries";
import type { Member } from "@fmerp/shared/lib/types";
import { Button } from "@fmerp/shared/ui/button";
import { ConfirmDialog } from "@fmerp/shared/ui/confirm-dialog";
import { useReauth } from "@fmerp/shared/ui/use-reauth";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { EnrollmentLinkBox } from "./enrollment-link";

/** 구성원 passkey 초기화 (PK1c API). 기기를 잃었을 때 전체 passkey를 지우고 새 등록 링크를 만든다. 확인 대화상자·결재 PIN 재인증 */
export function PasskeyResetSection({ member }: { member: Member }) {
  const queryClient = useQueryClient();
  const { data: account } = useCurrentAccount(true);
  const { run, dialog } = useReauth();
  const [confirming, setConfirming] = useState(false);
  const [issued, setIssued] = useState<{ token: string; expiresAt: string } | null>(null);

  if (account?.myRole !== "owner" && account?.myRole !== "admin") return null;

  async function reset() {
    await run(async () => {
      const result = await api<{
        token: string;
        expiresAt: string;
        removedPasskeys: number;
        endedSessions: number;
      }>(`/api/account/members/${member.userId}/passkey-reset`, { method: "POST" });
      setIssued({ token: result.token, expiresAt: result.expiresAt });
      await queryClient.invalidateQueries({ queryKey: ["members"] });
      toast.success(
        `passkey ${result.removedPasskeys}개를 지우고 로그인 세션 ${result.endedSessions}개를 종료했습니다`,
      );
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        기기를 잃었거나 passkey로 로그인할 수 없을 때 씁니다. 등록된 passkey를 모두 지우고 로그인
        세션을 끊습니다. 새 등록 링크는 이 화면에 한 번만 보입니다.
      </p>
      <Button variant="outline" onClick={() => setConfirming(true)}>
        passkey 초기화 (재등록 링크 발급)
      </Button>
      {issued && <EnrollmentLinkBox token={issued.token} expiresAt={issued.expiresAt} />}
      <ConfirmDialog
        open={confirming}
        title={`${member.name}님의 passkey를 초기화할까요?`}
        description="등록된 passkey와 로그인 세션이 모두 사라집니다. 되돌릴 수 없습니다."
        confirmLabel="초기화"
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void reset();
        }}
      />
      {dialog}
    </div>
  );
}

"use client";

import { api } from "@fmerp/shared/lib/api";
import { useCurrentAccount, useMe } from "@fmerp/shared/lib/queries";
import type { Member } from "@fmerp/shared/lib/types";
import { Button } from "@fmerp/shared/ui/button";
import { ConfirmDialog } from "@fmerp/shared/ui/confirm-dialog";
import { useReauth } from "@fmerp/shared/ui/use-reauth";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

/** 구성원 결재 PIN 초기화 (PIN 초기화 API). 잊은 PIN을 지워 미설정 상태로 되돌린다. 확인 대화상자·결재 PIN 재인증. 본인 PIN은 내 정보 화면에서 바꾼다 */
export function PinResetSection({ member }: { member: Member }) {
  const queryClient = useQueryClient();
  const { data: account } = useCurrentAccount(true);
  const { data: me } = useMe();
  const { run, dialog } = useReauth();
  const [confirming, setConfirming] = useState(false);

  if (account?.myRole !== "owner" && account?.myRole !== "admin") return null;
  if (me && member.userId === me.id) return null;

  async function reset() {
    await run(async () => {
      const result = await api<{ removed: number }>(
        `/api/account/members/${member.userId}/pin/reset`,
        { method: "POST" },
      );
      await queryClient.invalidateQueries({ queryKey: ["members"] });
      toast.success(
        result.removed > 0
          ? `${member.name}님의 결재 PIN을 초기화했습니다`
          : `${member.name}님은 설정된 결재 PIN이 없습니다`,
      );
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        결재 PIN을 잊었을 때 씁니다. 설정된 PIN을 지우고, 구성원이 다음 결재 때 새 PIN을 정하게
        합니다.
      </p>
      <Button variant="outline" onClick={() => setConfirming(true)}>
        결재 PIN 초기화
      </Button>
      <ConfirmDialog
        open={confirming}
        title={`${member.name}님의 결재 PIN을 초기화할까요?`}
        description="설정된 결재 PIN이 지워집니다. 되돌릴 수 없습니다."
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

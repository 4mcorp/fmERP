"use client";

import { api, errorMessage } from "@fmerp/shared/lib/api";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { ConfirmDialog } from "@fmerp/shared/ui/confirm-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useMyTelegram } from "@/lib/queries";

/** 연결 링크 유효 시간(10분)보다 조금 길게 연결 여부를 확인한다 */
const WAIT_MS = 10 * 60 * 1000;

/**
 * 텔레그램 알림 연결 (M8). 연결 링크를 열어 텔레그램에서 [시작]을 한 번 누르면 이후 결재 알림이 DM으로 온다.
 * 알림에는 문서 제목·내용이 들어가지 않고, 링크를 열면 로그인과 재인증을 거친다.
 */
export function TelegramSection() {
  const queryClient = useQueryClient();
  const { data, isPending } = useMyTelegram();
  const [waitingUntil, setWaitingUntil] = useState<number | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 만든 연결 링크. 팝업이 차단돼도 누를 수 있게 화면에 남긴다 */
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["my-telegram"] });

  // 링크를 연 뒤에는 연결이 끝났는지 3초마다 확인한다
  useEffect(() => {
    if (waitingUntil === null) return;
    const timer = setInterval(() => {
      if (Date.now() > waitingUntil) setWaitingUntil(null);
      else void queryClient.invalidateQueries({ queryKey: ["my-telegram"] });
    }, 3000);
    return () => clearInterval(timer);
  }, [waitingUntil, queryClient]);

  useEffect(() => {
    if (data?.linked && waitingUntil !== null) {
      setWaitingUntil(null);
      setLinkUrl(null);
      toast.success("텔레그램이 연결되었습니다");
    }
  }, [data?.linked, waitingUntil]);

  async function connect() {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>("/api/me/telegram/link", { method: "POST" });
      setLinkUrl(url);
      setWaitingUntil(Date.now() + WAIT_MS);
      // 비동기 응답 뒤라 브라우저가 팝업으로 막을 수 있다. 막히면 아래의 링크를 누른다
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    try {
      await api("/api/me/telegram/unlink", { method: "POST" });
      toast.success("텔레그램 연결을 해제했습니다");
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          텔레그램 알림
          {data?.enabled && (
            <Badge variant={data.linked ? "default" : "secondary"}>
              {data.linked ? "연결됨" : "연결 안 됨"}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          결재 차례가 되거나 내 문서가 반려·완료되면 텔레그램 대화로 알려 드립니다. 보안을 위해
          알림에는 문서 제목과 내용이 들어가지 않으며, 링크를 열면 로그인과 재인증을 거칩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isPending ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            불러오는 중…
          </p>
        ) : !data?.enabled ? (
          <p className="text-sm text-muted-foreground">
            이 서버에는 텔레그램 알림이 설정되어 있지 않습니다. 관리자에게 문의하세요.
          </p>
        ) : data.linked ? (
          <Button variant="outline" onClick={() => setConfirmUnlink(true)}>
            연결 해제
          </Button>
        ) : (
          <>
            <Button onClick={connect} disabled={busy}>
              <Send aria-hidden />
              텔레그램 연결
            </Button>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {waitingUntil === null
                ? "버튼을 누르면 텔레그램이 열립니다. 대화 아래의 [시작] 버튼을 한 번 누르면 끝납니다."
                : "텔레그램에서 [시작]을 눌러 주세요. 연결되면 이 화면이 자동으로 바뀝니다. (링크는 10분 동안 유효합니다)"}
            </p>
            {linkUrl && waitingUntil !== null && (
              <a
                href={linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-sm underline"
              >
                텔레그램이 열리지 않으면 여기를 누르세요
              </a>
            )}
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmUnlink}
        title="텔레그램 연결을 해제할까요?"
        description="해제하면 텔레그램으로 알림을 보내지 않습니다. 인앱 알림은 계속 받습니다."
        confirmLabel="해제"
        onConfirm={disconnect}
        onClose={() => setConfirmUnlink(false)}
      />
    </Card>
  );
}

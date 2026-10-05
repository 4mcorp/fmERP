"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useReauth } from "@/components/backup/use-reauth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiProblem, api, errorMessage } from "@/lib/api";
import { useSystemTelegram } from "@/lib/queries";
import { formatDateTime, type ReceiverMode } from "@/lib/types";

const MODE_LABEL: Record<ReceiverMode, string> = { polling: "폴링", webhook: "웹훅" };

const MODE_HELP: Record<ReceiverMode, string> = {
  polling:
    "서버가 텔레그램에 주기적으로 새 메시지를 물어봅니다. 공개 주소가 필요 없어 사내 서버에서 바로 쓸 수 있습니다.",
  webhook:
    "텔레그램이 새 메시지를 서버로 직접 보냅니다. 공개 https 주소와 TELEGRAM_WEBHOOK_SECRET이 필요합니다.",
};

/**
 * 텔레그램 수신 방식 설정 (M8). 사용자가 봇에게 보낸 /start를 받는 방법을 폴링·웹훅 중에서 고른다.
 * 알림 발송에는 영향이 없다. 바꾸면 worker가 30초 안에 적용한다. 시스템 관리자만 열 수 있다.
 */
export default function SystemTelegramPage() {
  const queryClient = useQueryClient();
  const { data, error, isPending } = useSystemTelegram(true);
  const { run, dialog } = useReauth();
  const [busy, setBusy] = useState(false);
  const notFound = error instanceof ApiProblem && error.status === 404;

  const change = (mode: ReceiverMode) =>
    run(async () => {
      setBusy(true);
      try {
        await api("/api/system/telegram/mode", { method: "POST", body: { mode } });
        toast.success(`${MODE_LABEL[mode]}으로 바꿨습니다. 곧 적용됩니다`);
        await queryClient.invalidateQueries({ queryKey: ["system-telegram"] });
      } finally {
        setBusy(false);
      }
    });

  if (notFound) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">페이지를 찾을 수 없습니다</h1>
        <p className="text-muted-foreground">시스템 관리자만 열 수 있는 화면입니다.</p>
      </div>
    );
  }

  const mismatch = data && data.applied?.mode !== data.mode;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">텔레그램 수신 방식</h1>
      {dialog}
      {error && !notFound && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(error)}
        </p>
      )}
      {isPending && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          불러오는 중…
        </p>
      )}

      {data && !data.configured.botToken && (
        <Alert role="alert">
          <AlertTitle>텔레그램 봇이 설정되지 않았습니다</AlertTitle>
          <AlertDescription>
            서버의 .env에 TELEGRAM_BOT_TOKEN과 TELEGRAM_BOT_USERNAME을 넣고 웹과 worker를 다시
            시작하세요. 설정 전에는 인앱 알림만 동작합니다.
          </AlertDescription>
        </Alert>
      )}

      {data?.applied?.error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>수신 방식을 적용하지 못했습니다</AlertTitle>
          <AlertDescription>
            {data.applied.error} ({formatDateTime(data.applied.at)})
          </AlertDescription>
        </Alert>
      )}

      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              현재 설정: {MODE_LABEL[data.mode]}
              {mismatch ? <Badge variant="secondary">적용 대기 중</Badge> : <Badge>적용됨</Badge>}
            </CardTitle>
            <CardDescription>
              worker가 적용한 방식:{" "}
              {data.applied?.mode ? MODE_LABEL[data.applied.mode] : "아직 확인되지 않음"}
              {data.applied ? ` (${formatDateTime(data.applied.at)} 확인)` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {(["polling", "webhook"] as const).map((mode) => {
                const disabled = mode === "webhook" && !data.configured.webhookReady;
                return (
                  <div key={mode} className="space-y-2 rounded-md border p-3">
                    <div className="font-medium">{MODE_LABEL[mode]}</div>
                    <p className="text-sm text-muted-foreground">{MODE_HELP[mode]}</p>
                    {disabled && (
                      <p className="text-sm text-muted-foreground">
                        지금은 쓸 수 없습니다. 공개 주소가 https가 아니거나 비밀 값이 없습니다
                        (주소: {data.configured.publicBaseUrl}).
                      </p>
                    )}
                    <Button
                      variant={data.mode === mode ? "secondary" : "default"}
                      disabled={busy || disabled || data.mode === mode || !data.configured.botToken}
                      onClick={() => change(mode)}
                    >
                      {data.mode === mode ? "사용 중" : `${MODE_LABEL[mode]}으로 전환`}
                    </Button>
                  </div>
                );
              })}
            </div>
            <p className="text-sm text-muted-foreground">
              전환 중에는 연결 요청이 최대 30초 늦게 처리될 수 있습니다. 이미 연결된 사용자의 알림
              발송에는 영향이 없습니다.
            </p>
            {data.webhook && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">텔레그램에 등록된 웹훅</dt>
                <dd>{data.webhook.url || "없음"}</dd>
                <dt className="text-muted-foreground">대기 중인 업데이트</dt>
                <dd>{data.webhook.pendingUpdateCount}건</dd>
                {data.webhook.lastErrorMessage && (
                  <>
                    <dt className="text-muted-foreground">마지막 오류</dt>
                    <dd>{data.webhook.lastErrorMessage}</dd>
                  </>
                )}
              </dl>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

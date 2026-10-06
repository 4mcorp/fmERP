"use client";

import { ApiProblem, api, errorMessage } from "@fmerp/shared/lib/api";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { PinDialog } from "@fmerp/shared/ui/pin-dialog";
import { Download, FileArchive, FileText, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { usePackageStatus } from "@/lib/queries";
import { formatDateTime } from "@/lib/types";

/**
 * 완료 문서의 PDF·패키지 내려받기 (APV-063, BAK-008). PDF는 worker가 만들어서 몇 초 걸릴 수 있다.
 * 패키지 ZIP은 PIN 재인증이 필요하고, 내려받기는 모두 감사 로그에 남는다.
 */
export function CompletionFiles({ documentId }: { documentId: string }) {
  const { data } = usePackageStatus(documentId, true);
  const [busy, setBusy] = useState<"pdf" | "zip" | null>(null);
  const [pin, setPin] = useState<{ needsSetup: boolean } | null>(null);
  const retry = useRef<(() => Promise<void>) | null>(null);

  async function run(kind: "pdf" | "zip", task: () => Promise<void>) {
    setBusy(kind);
    try {
      await task();
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 428) {
        retry.current = task;
        setPin({ needsSetup: error.code === "pin_not_set" });
      } else {
        toast.error(errorMessage(error));
      }
    } finally {
      setBusy(null);
    }
  }

  const downloadPdf = () =>
    run("pdf", async () => {
      const { url } = await api<{ url: string }>(`/api/approvals/${documentId}/package/pdf`);
      window.location.assign(url);
    });

  const downloadZip = () =>
    run("zip", async () => {
      // 재인증과 권한을 먼저 확인하고(파일은 열지 않는다), 통과하면 브라우저가 스트리밍으로 받는다
      await api(`/api/approvals/${documentId}/package/zip?check=1`);
      window.location.assign(`/api/approvals/${documentId}/package/zip`);
    });

  const status = data?.status;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-4" aria-hidden />
          결재 완료 문서
        </CardTitle>
        <CardDescription>
          {status === "READY"
            ? `결재란이 찍힌 PDF와 증빙 패키지입니다. ${data?.readyAt ? `${formatDateTime(data.readyAt)} 생성` : ""}`
            : status === "FAILED"
              ? "PDF를 만들지 못했습니다. 관리자에게 문의하세요."
              : "PDF를 만드는 중입니다. 보통 1~2분 안에 끝납니다."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        {status === "READY" ? (
          <>
            <Button variant="outline" onClick={downloadPdf} disabled={busy !== null}>
              <Download aria-hidden />
              PDF 내려받기
            </Button>
            <Button variant="outline" onClick={downloadZip} disabled={busy !== null}>
              <FileArchive aria-hidden />
              패키지(ZIP) 내려받기
            </Button>
            <p className="text-xs text-muted-foreground">
              패키지에는 PDF·본문·결재 이력·첨부가 들어 있고, 내려받으면 기록됩니다.
            </p>
          </>
        ) : status === "FAILED" ? null : (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
            PDF 생성 중…
          </p>
        )}
      </CardContent>
      <PinDialog
        open={pin !== null}
        needsSetup={pin?.needsSetup ?? false}
        onClose={() => setPin(null)}
        onVerified={() => {
          setPin(null);
          const task = retry.current;
          retry.current = null;
          if (task) void run("zip", task);
        }}
      />
    </Card>
  );
}

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Download, PackagePlus } from "lucide-react";
import { toast } from "sonner";
import { useReauth } from "@/components/backup/use-reauth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiProblem, api, errorMessage } from "@/lib/api";
import { useAccountExports } from "@/lib/queries";
import { type AccountExportItem, formatBytes, formatDateTime } from "@/lib/types";

const STATUS_LABEL: Record<AccountExportItem["status"], string> = {
  QUEUED: "대기 중",
  RUNNING: "만드는 중",
  READY: "완성",
  FAILED: "실패",
  EXPIRED: "만료",
};

const statusVariant = (s: AccountExportItem["status"]) =>
  s === "FAILED" ? "destructive" : s === "READY" ? "default" : "secondary";

/**
 * 계정 전체 내보내기 (PRD BAK-009): 완료 문서 패키지·첨부·조직·양식·감사 로그를 ZIP 하나로 받는다.
 * 요청과 내려받기마다 PIN 재인증을 거치고 기록이 남는다. 파일은 7일 동안 보관된다.
 */
export default function BackupsPage() {
  const queryClient = useQueryClient();
  const { data, error, isPending } = useAccountExports(true);
  const { run, dialog } = useReauth();
  const forbidden = error instanceof ApiProblem && error.status === 403;
  const active = data?.items.some((i) => i.status === "QUEUED" || i.status === "RUNNING") ?? false;

  const request = () =>
    run(async () => {
      await api("/api/account/exports", { method: "POST" });
      toast.success("내보내기를 요청했습니다. 완성되면 이 화면에서 내려받을 수 있습니다");
      await queryClient.invalidateQueries({ queryKey: ["account-exports"] });
    });

  const download = (id: string) =>
    run(async () => {
      const { url } = await api<{ url: string }>(`/api/account/exports/${id}/download`);
      await queryClient.invalidateQueries({ queryKey: ["account-exports"] });
      // 서명 URL로 이동하면 브라우저가 파일을 내려받는다 (응답이 첨부 파일로 내려온다)
      window.location.assign(url);
    });

  if (forbidden) {
    return (
      <p role="alert" className="text-muted-foreground">
        계정 전체 내보내기는 소유자만 할 수 있습니다. 소유자가 계정 관리자에게 허용하면 쓸 수
        있습니다.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">계정 내보내기</h1>
      {dialog}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">계정 전체를 ZIP으로 내보내기</CardTitle>
          <CardDescription>
            결재가 끝나고 PDF가 만들어진 문서(본문·결재 이력·첨부)와 조직·양식·감사 로그를 한 파일로
            받습니다. 진행 중이거나 반려된 문서, 서명·도장 이미지는 담기지 않습니다. 완성된 파일은
            7일 동안 보관되며, 받을 때마다 PIN을 확인하고 기록이 남습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={request} disabled={active || isPending}>
            <PackagePlus aria-hidden />
            내보내기 요청
          </Button>
          {active && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              내보내기를 만들고 있습니다. 문서가 많으면 시간이 걸릴 수 있습니다.
            </p>
          )}
          {data?.allowAdminExport && (
            <Alert>
              <AlertTitle>계정 관리자에게 허용되어 있습니다</AlertTitle>
              <AlertDescription>
                내보내기 파일에는 모든 완료 문서의 본문이 들어 있습니다. 설정은 계정 설정에서
                소유자가 바꿀 수 있습니다.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {error && !forbidden && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(error)}
        </p>
      )}
      {isPending ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          불러오는 중…
        </p>
      ) : data?.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">아직 내보낸 기록이 없습니다.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">요청 일시</TableHead>
              <TableHead scope="col">요청자</TableHead>
              <TableHead scope="col">상태</TableHead>
              <TableHead scope="col">크기</TableHead>
              <TableHead scope="col">해시(SHA-256)</TableHead>
              <TableHead scope="col">보관 기한</TableHead>
              <TableHead scope="col">내려받은 기록</TableHead>
              <TableHead scope="col">
                <span className="sr-only">작업</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((j) => (
              <TableRow key={j.id}>
                <TableCell className="whitespace-nowrap">{formatDateTime(j.createdAt)}</TableCell>
                <TableCell>{j.requestedByName ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(j.status)}>{STATUS_LABEL[j.status]}</Badge>
                  {j.status === "FAILED" && j.error && (
                    <p className="mt-1 max-w-56 text-xs break-words text-destructive">{j.error}</p>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatBytes(j.size)}</TableCell>
                <TableCell>
                  {j.sha256 ? (
                    <span className="font-mono text-xs" title={j.sha256}>
                      {j.sha256.slice(0, 12)}…
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {j.expiresAt ? formatDateTime(j.expiresAt) : "—"}
                </TableCell>
                <TableCell>
                  {j.downloads.length === 0
                    ? "—"
                    : `${j.downloads.length}회 (최근 ${j.downloads[0]?.userName ?? "알 수 없음"}, ${formatDateTime(j.downloads[0]?.at ?? "")})`}
                </TableCell>
                <TableCell>
                  {j.status === "READY" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => download(j.id)}
                      aria-label={`${formatDateTime(j.createdAt)} 내보내기 내려받기`}
                    >
                      <Download aria-hidden />
                      내려받기
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

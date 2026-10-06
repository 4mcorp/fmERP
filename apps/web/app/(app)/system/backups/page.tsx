"use client";

import { ApiProblem, api, errorMessage } from "@fmerp/shared/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@fmerp/shared/ui/alert";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { ConfirmDialog } from "@fmerp/shared/ui/confirm-dialog";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@fmerp/shared/ui/table";
import { useReauth } from "@fmerp/shared/ui/use-reauth";
import { useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup, Download, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { useSystemBackups } from "@/lib/queries";
import { formatBytes, formatDateTime, type SystemBackupItem } from "@/lib/types";

const STATUS_LABEL: Record<SystemBackupItem["status"], string> = {
  QUEUED: "대기 중",
  RUNNING: "실행 중",
  SUCCEEDED: "성공",
  SKIPPED: "건너뜀 (변경 없음)",
  FAILED: "실패",
};

const statusVariant = (s: SystemBackupItem["status"]) =>
  s === "FAILED" ? "destructive" : s === "SUCCEEDED" ? "default" : "secondary";

/**
 * DB 덤프 이력·수동 덤프 (PRD BAK-005~007). 덤프에는 모든 회사의 데이터가 들어 있어 시스템 관리자만 열 수 있다.
 * 파일은 서버가 가진 공개키로 암호화되어 있고, 열려면 서버 밖에 보관한 개인키가 필요하다.
 */
export default function SystemBackupsPage() {
  const queryClient = useQueryClient();
  const { data, error, isPending } = useSystemBackups(true);
  const { run, dialog } = useReauth();
  const [note, setNote] = useState("");
  const [deleting, setDeleting] = useState<SystemBackupItem | null>(null);
  const notFound = error instanceof ApiProblem && error.status === 404;
  const active = data?.items.some((i) => i.status === "QUEUED" || i.status === "RUNNING") ?? false;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["system-backups"] });

  function requestDump(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api("/api/system/backups", {
        method: "POST",
        body: { note: note.trim() || undefined },
      });
      setNote("");
      toast.success("덤프를 요청했습니다. 잠시 뒤 실행됩니다");
      await refresh();
    });
  }

  const download = (id: string) =>
    run(async () => {
      const { url } = await api<{ url: string }>(`/api/system/backups/${id}/download`);
      await refresh();
      window.location.assign(url);
    });

  const remove = (id: string) =>
    run(async () => {
      await api(`/api/system/backups/${id}/delete`, { method: "POST" });
      toast.success("삭제를 요청했습니다. 보관 규칙에 따라 곧 정리됩니다");
      await refresh();
    });

  if (notFound) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">페이지를 찾을 수 없습니다</h1>
        <p className="text-muted-foreground">시스템 관리자만 열 수 있는 화면입니다.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">시스템 덤프</h1>
      {dialog}

      {data &&
        (data.health.state === "overdue" ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>자동 덤프가 기한 안에 성공하지 못했습니다</AlertTitle>
            <AlertDescription>
              {formatDateTime(data.health.expectedBy)}까지 성공한 덤프가 있어야 합니다. 마지막 성공:{" "}
              {data.health.lastSuccessAt ? formatDateTime(data.health.lastSuccessAt) : "없음"}. 아래
              이력의 오류를 확인하고 필요하면 지금 덤프를 실행하세요.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertTitle>백업 상태 정상</AlertTitle>
            <AlertDescription>
              마지막 성공:{" "}
              {data.health.lastSuccessAt ? formatDateTime(data.health.lastSuccessAt) : "—"}. 자동
              덤프는 매일 새벽 3시(한국 시간)에 실행됩니다.
            </AlertDescription>
          </Alert>
        ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">지금 덤프 실행</CardTitle>
          <CardDescription>
            운영 배포나 이관 직전에 실행합니다. 수동 덤프는 직접 삭제하기 전까지 보관됩니다. 파일은
            암호화되어 저장되며 개인키 없이는 열 수 없습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={requestDump} className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1 space-y-2">
              <Label htmlFor="dump-note">메모 (선택)</Label>
              <Input
                id="dump-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                autoComplete="off"
                placeholder="예: 서버 이전 직전…"
              />
            </div>
            <Button type="submit" disabled={active || isPending}>
              <DatabaseBackup aria-hidden />
              덤프 요청
            </Button>
          </form>
          {active && (
            <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
              덤프가 실행 중이거나 대기 중입니다.
            </p>
          )}
        </CardContent>
      </Card>

      {error && !notFound && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(error)}
        </p>
      )}
      {isPending ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          불러오는 중…
        </p>
      ) : data?.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">아직 덤프 기록이 없습니다.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">일시</TableHead>
              <TableHead scope="col">유형</TableHead>
              <TableHead scope="col">상태</TableHead>
              <TableHead scope="col">크기</TableHead>
              <TableHead scope="col">해시(SHA-256)</TableHead>
              <TableHead scope="col">실행자·메모</TableHead>
              <TableHead scope="col">내려받은 기록</TableHead>
              <TableHead scope="col">
                <span className="sr-only">작업</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="whitespace-nowrap">{formatDateTime(b.requestedAt)}</TableCell>
                <TableCell>{b.kind === "auto" ? "자동" : "수동"}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(b.status)}>{STATUS_LABEL[b.status]}</Badge>
                  {b.deleteRequestedAt && (
                    <p className="mt-1 text-xs text-muted-foreground">삭제 요청됨</p>
                  )}
                  {b.status === "FAILED" && b.error && (
                    <p className="mt-1 max-w-56 text-xs break-words text-destructive">{b.error}</p>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatBytes(b.size)}</TableCell>
                <TableCell>
                  {b.sha256 ? (
                    <span className="font-mono text-xs" title={b.sha256}>
                      {b.sha256.slice(0, 12)}…
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="max-w-48 break-words">
                  {[b.requestedByName ?? (b.kind === "auto" ? "시스템" : null), b.note]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </TableCell>
                <TableCell>
                  {b.downloads.length === 0
                    ? "—"
                    : `${b.downloads.length}회 (최근 ${b.downloads[0]?.userName ?? "알 수 없음"}, ${formatDateTime(b.downloads[0]?.at ?? "")})`}
                </TableCell>
                <TableCell className="space-x-1 whitespace-nowrap">
                  {b.status === "SUCCEEDED" && !b.deleteRequestedAt && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => download(b.id)}
                      aria-label={`${formatDateTime(b.requestedAt)} 덤프 내려받기`}
                    >
                      <Download aria-hidden />
                      내려받기
                    </Button>
                  )}
                  {b.kind === "manual" && b.status === "SUCCEEDED" && !b.deleteRequestedAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleting(b)}
                      aria-label={`${formatDateTime(b.requestedAt)} 덤프 삭제 요청`}
                    >
                      <Trash2 aria-hidden />
                      삭제
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="수동 덤프를 삭제할까요?"
        description="삭제를 요청하면 더 이상 내려받을 수 없고, 저장소의 보관 규칙이 파일을 지웁니다. 되돌릴 수 없습니다."
        confirmLabel="삭제 요청"
        onConfirm={() => deleting && void remove(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

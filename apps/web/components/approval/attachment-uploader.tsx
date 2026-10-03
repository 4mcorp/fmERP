"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Paperclip, Trash2 } from "lucide-react";
import { type ChangeEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { useAttachments } from "@/lib/queries";
import type { AttachmentInfo } from "@/lib/types";

const PREVIEWABLE = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 첨부 한 건의 다운로드·미리보기. 서명 URL은 권한 확인 후 짧은 수명으로 받는다 (FILE-004·005) */
export function AttachmentList({
  documentId,
  items,
  onRemove,
}: {
  documentId: string;
  items: AttachmentInfo[];
  onRemove?: (a: AttachmentInfo) => void;
}) {
  async function open(a: AttachmentInfo, preview: boolean) {
    try {
      const { url } = await api<{ url: string }>(
        `/api/approvals/${documentId}/attachments/${a.id}/url${preview ? "?preview=true" : ""}`,
      );
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }
  if (items.length === 0) return <p className="text-sm text-muted-foreground">첨부가 없습니다.</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 break-all">{a.filename}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{formatSize(a.size)}</span>
          {PREVIEWABLE.test(a.mime) && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => open(a, true)}
              aria-label={`${a.filename} 미리보기`}
            >
              <Eye aria-hidden />
              미리보기
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => open(a, false)}
            aria-label={`${a.filename} 다운로드`}
          >
            <Download aria-hidden />
            다운로드
          </Button>
          {onRemove && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => onRemove(a)}
              aria-label={`${a.filename} 삭제`}
            >
              <Trash2 aria-hidden />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * 첨부 올리기 (APV-013): 서버가 크기를 고정한 서명 URL을 주면 브라우저가 저장소로 직접 올리고,
 * 서버가 크기·형식·해시를 검증해 등록한다 (ADR 0008). 검증에 실패하면 사유를 보여 준다.
 */
export function AttachmentUploader({
  documentId,
  onChanged,
}: {
  documentId: string;
  onChanged?: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: items } = useAttachments(documentId);
  const [busy, setBusy] = useState<string[]>([]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["approval-attachments", documentId] });
    onChanged?.();
  }

  async function uploadOne(file: File) {
    setBusy((b) => [...b, file.name]);
    try {
      const { uploadUrl, stagingKey, contentType } = await api<{
        uploadUrl: string;
        stagingKey: string;
        contentType: string;
      }>(`/api/approvals/${documentId}/attachments/upload-url`, {
        method: "POST",
        body: { filename: file.name, size: file.size },
      });
      const put = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": contentType },
      });
      if (!put.ok) throw new Error("업로드에 실패했습니다");
      await api(`/api/approvals/${documentId}/attachments`, {
        method: "POST",
        body: { stagingKey, filename: file.name, size: file.size },
      });
      toast.success(`${file.name}을(를) 올렸습니다`);
    } catch (error) {
      toast.error(`${file.name}: ${errorMessage(error)}`);
    } finally {
      setBusy((b) => b.filter((n) => n !== file.name));
    }
  }

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    for (const f of files) await uploadOne(f);
    await refresh();
  }

  async function remove(a: AttachmentInfo) {
    if (!window.confirm(`${a.filename}을(를) 삭제할까요?`)) return;
    try {
      await api(`/api/approvals/${documentId}/attachments/${a.id}`, { method: "DELETE" });
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="attachment-input" className="sr-only">
        첨부 파일 선택
      </Label>
      <Input
        id="attachment-input"
        type="file"
        multiple
        onChange={onFiles}
        disabled={busy.length > 0}
      />
      {busy.length > 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          올리는 중… {busy.join(", ")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        파일당 기본 50MB, 문서당 300MB까지 (계정 정책에 따름). 실행 파일은 올릴 수 없습니다.
      </p>
      <AttachmentList documentId={documentId} items={items ?? []} onRemove={remove} />
    </div>
  );
}

"use client";

import { ApiProblem, api, errorMessage } from "@fmerp/shared/lib/api";
import { formatDateTime } from "@fmerp/shared/lib/format";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { Label } from "@fmerp/shared/ui/label";
import { Modal } from "@fmerp/shared/ui/modal";
import { PageHeader } from "@fmerp/shared/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@fmerp/shared/ui/table";
import { Textarea } from "@fmerp/shared/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { AuditTabs } from "../components/audit-tabs";
import { type AuditReviewMonth, useAuditReviews } from "../queries";

const STATE_LABEL: Record<AuditReviewMonth["state"], string> = {
  pending: "미점검",
  done: "점검 완료",
  abnormal: "이상 있음",
};

/** `YYYY-MM`의 첫날과 마지막 날 (로그 조회 링크용) */
function monthRange(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
}

function ReviewDialog({ period, onClose }: { period: string | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [memo, setMemo] = useState("");
  const [abnormal, setAbnormal] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setMemo("");
    setAbnormal(false);
    setNote("");
    setError(null);
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!period) return;
    if (abnormal && note.trim() === "") {
      setError("이상이 있으면 내용을 적어야 합니다.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/api/audit-logs/reviews", {
        method: "POST",
        body: {
          period,
          memo: memo.trim() || undefined,
          abnormal,
          abnormalNote: abnormal ? note.trim() : undefined,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["audit-reviews"] });
      toast.success(`${period} 점검을 기록했습니다`);
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={period !== null}
      onClose={close}
      title={`${period ?? ""} 접속 기록 점검`}
      description="로그 조회 화면에서 그 달의 접속 기록을 확인한 뒤 결과를 남깁니다. 기록은 수정·삭제할 수 없고, 고치려면 새로 남깁니다."
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="r-memo">메모 (선택)</Label>
          <Textarea
            id="r-memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={1000}
            rows={3}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="r-abnormal"
            type="checkbox"
            checked={abnormal}
            onChange={(e) => setAbnormal(e.target.checked)}
            className="size-4"
          />
          <Label htmlFor="r-abnormal">이상 징후가 있었습니다</Label>
        </div>
        {abnormal && (
          <div className="space-y-2">
            <Label htmlFor="r-note">이상 내용 (필수)</Label>
            <Textarea
              id="r-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              rows={3}
              required
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>
            취소
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "기록하는 중…" : "점검 완료"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * 월 1회 접속 기록 점검 (AUD-026, 개인정보의 안전성 확보조치): 직전 달의 접속 기록을 확인하고 "점검 완료"를 남긴다.
 * 같은 달에 여러 번 남길 수 있고 마지막 기록이 그 달의 현재 상태다.
 */
export default function AuditReviewPage() {
  const { data, error, isPending } = useAuditReviews(true);
  const [target, setTarget] = useState<string | null>(null);
  const forbidden = error instanceof ApiProblem && error.status === 403;

  if (forbidden) {
    return (
      <p role="alert" className="text-muted-foreground">
        접속 기록을 점검할 권한이 없습니다. (계정 범위 감사 권한이 필요합니다)
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="감사 로그"
        description='매달 지난달의 접속 기록을 확인하고 점검 결과를 남깁니다. 점검을 거르면 이 화면과 메뉴에 "점검 필요"가 표시됩니다.'
      />
      <AuditTabs />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(error)}
        </p>
      )}
      {isPending ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          불러오는 중…
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">대상 달</TableHead>
              <TableHead scope="col">상태</TableHead>
              <TableHead scope="col">점검자·일시</TableHead>
              <TableHead scope="col">메모·이상 내용</TableHead>
              <TableHead scope="col">
                <span className="sr-only">작업</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.months.map((m) => {
              const range = monthRange(m.period);
              return (
                <TableRow key={m.period}>
                  <TableCell className="whitespace-nowrap font-medium">{m.period}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        m.state === "pending"
                          ? "danger"
                          : m.state === "abnormal"
                            ? "warning"
                            : "success"
                      }
                    >
                      {STATE_LABEL[m.state]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {m.last ? `${m.last.reviewerName} · ${formatDateTime(m.last.reviewedAt)}` : "—"}
                  </TableCell>
                  <TableCell className="max-w-72 break-words">
                    {m.last?.abnormal
                      ? `이상: ${m.last.abnormalNote ?? ""}${m.last.memo ? ` / ${m.last.memo}` : ""}`
                      : (m.last?.memo ?? "")}
                  </TableCell>
                  <TableCell className="space-x-1 whitespace-nowrap">
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        href={`/admin/audit?from=${range.from}&to=${range.to}&action=auth.`}
                        aria-label={`${m.period} 접속 기록 보기`}
                      >
                        접속 기록
                      </Link>
                    </Button>
                    <Button
                      variant={m.state === "pending" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setTarget(m.period)}
                      aria-label={`${m.period} ${m.last ? "다시 점검 기록" : "점검 완료 기록"}`}
                    >
                      {m.last ? "다시 기록" : "점검 완료"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <ReviewDialog period={target} onClose={() => setTarget(null)} />
    </div>
  );
}

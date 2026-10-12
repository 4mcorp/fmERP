"use client";

import { ApiProblem, api, errorMessage } from "@fmerp/shared/lib/api";
import { useMembers } from "@fmerp/shared/lib/queries";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { DataTable, type DataTableColumn } from "@fmerp/shared/ui/data-table";
import { EmptyState } from "@fmerp/shared/ui/empty-state";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import { PinDialog } from "@fmerp/shared/ui/pin-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@fmerp/shared/ui/select";
import { StatusBadge } from "@fmerp/shared/ui/status-badge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useRef, useState } from "react";
import { toast } from "sonner";
import { ApprovalPageLayout } from "../components/approval-page-layout";

interface OverdueItem {
  id: string;
  title: string;
  docNo: string | null;
  status: string;
  drafterName: string;
  waiting: { name?: string; positionName?: string }[];
  waitingDays: number;
}

const DAY_OPTIONS = ["3", "7", "14", "30"];

const OVERDUE_COLUMNS: DataTableColumn<OverdueItem>[] = [
  {
    id: "title",
    header: "제목",
    className: "max-w-72",
    sortValue: (d) => d.title,
    cell: (d) => (
      <Link
        href={`/approval/${d.id}`}
        className="break-words font-medium underline-offset-4 hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {d.title}
      </Link>
    ),
  },
  {
    id: "drafter",
    header: "기안자",
    hideBelow: "sm",
    sortValue: (d) => d.drafterName,
    cell: (d) => d.drafterName,
  },
  {
    id: "status",
    header: "상태",
    sortValue: (d) => d.status,
    cell: (d) => <StatusBadge kind="document" status={d.status} />,
  },
  {
    id: "waiting",
    header: "대기 중인 사람",
    hideBelow: "md",
    cell: (d) =>
      d.waiting
        .map((w) => w.name)
        .filter(Boolean)
        .join(", ") || "-",
  },
  {
    id: "waitingDays",
    header: "경과",
    align: "right",
    sortValue: (d) => d.waitingDays,
    cell: (d) => `${d.waitingDays}일`,
  },
];

/**
 * 결재 문서 관리 (ADM-005, ORG-036): 결재자 일괄 이관과 장기 미처리 문서.
 * 이관은 결재 관리자만, PIN 재인증과 사유가 필요하고 문서마다 감사 로그에 남는다.
 */
function ApprovalAdminView() {
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const { data: members } = useMembers();
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState<{ needsSetup: boolean } | null>(null);
  const retry = useRef<(() => Promise<void>) | null>(null);

  const overdue = useQuery({
    queryKey: ["approval-overdue", days],
    queryFn: () => api<OverdueItem[]>(`/api/approval-admin/overdue?days=${days}`),
  });
  const forbidden = overdue.error instanceof ApiProblem && overdue.error.status === 403;

  async function transfer() {
    setBusy(true);
    try {
      const result = await api<{ documents: number; steps: number }>(
        "/api/approval-admin/transfer",
        {
          method: "POST",
          body: { fromMembershipId: from, toMembershipId: to, reason },
        },
      );
      toast.success(
        result.documents === 0
          ? "이관할 결재가 없습니다"
          : `문서 ${result.documents}건(단계 ${result.steps}개)을 이관했습니다`,
      );
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["approval-overdue"] });
      await queryClient.invalidateQueries({ queryKey: ["inbox-pending"] });
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 428) {
        retry.current = transfer;
        setPin({ needsSetup: error.code === "pin_not_set" });
      } else {
        toast.error(errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void transfer();
  }

  const people = (members ?? []).filter((m) => m.status !== "left");
  const heirs = people.filter((m) => m.status === "active" && m.membershipId !== from);

  return (
    <ApprovalPageLayout title="결재 문서 관리">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">결재자 일괄 이관</CardTitle>
          <CardDescription>
            퇴사·휴직하는 사람이 처리해야 할 진행 중 결재를 대체 결재자에게 한 번에 넘깁니다. 이미
            처리한 단계는 바뀌지 않으며, 문서마다 사유와 함께 기록됩니다. 진행 중 결재가 있으면
            퇴사·휴직 처리를 할 수 없으니 먼저 이관하세요.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tr-from">이관할 사람</Label>
              <Select value={from} onValueChange={setFrom}>
                <SelectTrigger id="tr-from" className="w-full">
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                  {people.map((m) => (
                    <SelectItem key={m.membershipId} value={m.membershipId}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tr-to">대체 결재자</Label>
              <Select value={to} onValueChange={setTo}>
                <SelectTrigger id="tr-to" className="w-full">
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                  {heirs.map((m) => (
                    <SelectItem key={m.membershipId} value={m.membershipId}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="tr-reason">사유 (필수)</Label>
              <Input
                id="tr-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="퇴사 인수인계, 장기 휴직 등…"
                maxLength={200}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy || !from || !to || reason.trim() === ""}>
                {busy ? "이관 중…" : "이관"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">장기 미처리 문서</CardTitle>
          <CardDescription>
            마지막 변경 후 지정한 기간이 지난 진행 중 문서입니다. 결재 관리 범위의 사업자 문서만
            보입니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="ov-days">기준</Label>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger id="ov-days" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_OPTIONS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}일 이상
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {forbidden ? (
            <p role="alert" className="text-sm text-destructive">
              결재 관리 권한이 없습니다.
            </p>
          ) : (
            <DataTable
              caption="장기 미처리 결재 문서 목록"
              rows={overdue.data ?? []}
              columns={OVERDUE_COLUMNS}
              rowKey={(d) => d.id}
              isLoading={overdue.isLoading}
              empty={<EmptyState title="오래 걸린 문서가 없습니다." />}
            />
          )}
        </CardContent>
      </Card>

      <PinDialog
        open={pin !== null}
        needsSetup={pin?.needsSetup ?? false}
        onClose={() => setPin(null)}
        onVerified={() => {
          setPin(null);
          const task = retry.current;
          retry.current = null;
          if (task) void task();
        }}
      />
    </ApprovalPageLayout>
  );
}

export default function ApprovalAdminPage() {
  return (
    <Suspense fallback={null}>
      <ApprovalAdminView />
    </Suspense>
  );
}

"use client";

import { api, errorMessage } from "@fmerp/shared/lib/api";
import { useCapabilities, useForms, useMe, useMembers } from "@fmerp/shared/lib/queries";
import { formatDateTime } from "@fmerp/shared/lib/types";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { ConfirmDialog } from "@fmerp/shared/ui/confirm-dialog";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import { LoadingState } from "@fmerp/shared/ui/loading-state";
import { PageHeader } from "@fmerp/shared/ui/page-header";
import { QueryErrorState } from "@fmerp/shared/ui/query-error-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@fmerp/shared/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@fmerp/shared/ui/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";

interface Delegation {
  id: string;
  membershipId: string;
  delegateMembershipId: string;
  from: string;
  to: string;
  scope: { kind: "all" | "category"; categories?: string[] };
  reason: string | null;
}

/** `datetime-local` 값(서울 시간)을 UTC ISO로 바꾼다 */
const toIso = (local: string) => new Date(`${local}:00+09:00`).toISOString();

/** 부재·대결 설정 (APV-050·052·053): 본인 설정, 관리자는 다른 사람의 부재도 대행한다 */
export default function AbsencePage() {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const { data: members, isError: membersIsError, refetch: refetchMembers } = useMembers();
  const { data: forms } = useForms();
  const { data: caps } = useCapabilities(Boolean(me?.activeAccountId));
  const { data: list } = useQuery({
    queryKey: ["delegations"],
    queryFn: () => api<Delegation[]>("/api/delegations"),
  });

  const [absentee, setAbsentee] = useState("");
  const [revoking, setRevoking] = useState<Delegation | null>(null);
  const [delegate, setDelegate] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [scopeKind, setScopeKind] = useState<"all" | "category">("all");
  const [categories, setCategories] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const myId = members?.find((m) => m.userId === me?.id)?.membershipId;
  const canProxy = Boolean(caps?.["delegation.manage"]);
  const nameOf = (id: string) =>
    members?.find((m) => m.membershipId === id)?.name ?? "(알 수 없음)";
  const allCategories = useMemo(() => [...new Set((forms ?? []).map((f) => f.category))], [forms]);
  const activeMembers = (members ?? []).filter((m) => m.status === "active");

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/api/delegations", {
        method: "POST",
        body: {
          ...(canProxy && absentee && absentee !== myId ? { membershipId: absentee } : {}),
          delegateMembershipId: delegate,
          from: toIso(from),
          to: toIso(to),
          scope: scopeKind === "all" ? { kind: "all" } : { kind: "category", categories },
          reason: reason || undefined,
        },
      });
      toast.success("부재를 설정했습니다");
      setDelegate("");
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["delegations"] });
      await queryClient.invalidateQueries({ queryKey: ["inbox-pending"] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function revoke(d: Delegation) {
    try {
      await api(`/api/delegations/${d.id}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["delegations"] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (membersIsError) return <QueryErrorState onRetry={() => void refetchMembers()} />;
  if (!me || !members) return <LoadingState />;
  const now = new Date();

  return (
    <div className="w-full min-w-0 space-y-4">
      <PageHeader title="부재 설정" />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">부재·대결 등록</CardTitle>
          <CardDescription>
            부재 기간에 내 차례가 오는 결재는 대결자가 처리합니다(나도 처리할 수 있고, 먼저 처리한
            쪽만 반영). 대결자가 다시 위임할 수는 없습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid gap-4 sm:grid-cols-2">
            {canProxy && (
              <div className="space-y-2">
                <Label htmlFor="abs-who">부재자 (관리자 대행)</Label>
                <Select value={absentee || myId} onValueChange={setAbsentee}>
                  <SelectTrigger id="abs-who" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {activeMembers.map((m) => (
                      <SelectItem key={m.membershipId} value={m.membershipId}>
                        {m.name}
                        {m.membershipId === myId ? " (본인)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="abs-delegate">대결자</Label>
              <Select value={delegate || undefined} onValueChange={setDelegate}>
                <SelectTrigger id="abs-delegate" className="w-full">
                  <SelectValue placeholder="대결자 선택" />
                </SelectTrigger>
                <SelectContent>
                  {activeMembers
                    .filter((m) => m.membershipId !== (absentee || myId))
                    .map((m) => (
                      <SelectItem key={m.membershipId} value={m.membershipId}>
                        {m.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="abs-from">시작</Label>
              <Input
                id="abs-from"
                type="datetime-local"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="abs-to">종료</Label>
              <Input
                id="abs-to"
                type="datetime-local"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="abs-scope">적용 범위</Label>
              <Select
                value={scopeKind}
                onValueChange={(v) => setScopeKind(v as "all" | "category")}
              >
                <SelectTrigger id="abs-scope" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">모든 결재</SelectItem>
                  <SelectItem value="category">특정 양식 분류만</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="abs-reason">사유 (선택)</Label>
              <Input
                id="abs-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="휴가, 출장 등"
                maxLength={200}
                autoComplete="off"
              />
            </div>
            {scopeKind === "category" && (
              <fieldset className="space-y-1 sm:col-span-2">
                <legend className="text-sm font-medium">양식 분류</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {allCategories.map((c) => (
                    <label key={c} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={categories.includes(c)}
                        onChange={(e) =>
                          setCategories((x) =>
                            e.target.checked ? [...x, c] : x.filter((y) => y !== c),
                          )
                        }
                      />
                      {c}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive sm:col-span-2">
                {error}
              </p>
            )}
            <div className="sm:col-span-2">
              <Button
                type="submit"
                disabled={
                  !delegate || !from || !to || (scopeKind === "category" && categories.length === 0)
                }
              >
                부재 설정
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>부재자</TableHead>
                <TableHead>대결자</TableHead>
                <TableHead>기간</TableHead>
                <TableHead>범위</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="text-right">작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list ?? []).map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{nameOf(d.membershipId)}</TableCell>
                  <TableCell>{nameOf(d.delegateMembershipId)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(d.from)} ~ {formatDateTime(d.to)}
                  </TableCell>
                  <TableCell>
                    {d.scope.kind === "all" ? "모든 결재" : (d.scope.categories ?? []).join(", ")}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        new Date(d.from) <= now && now <= new Date(d.to) ? "default" : "outline"
                      }
                    >
                      {new Date(d.to) < now ? "종료" : new Date(d.from) > now ? "예정" : "적용 중"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {(d.membershipId === myId || canProxy) && (
                      <Button size="sm" variant="outline" onClick={() => setRevoking(d)}>
                        취소
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(list ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    등록된 부재 설정이 없습니다.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={revoking !== null}
        title="부재 설정을 취소할까요?"
        confirmLabel="취소하기"
        onConfirm={() => revoking && void revoke(revoking)}
        onClose={() => setRevoking(null)}
      />
    </div>
  );
}

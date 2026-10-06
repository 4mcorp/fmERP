"use client";

import { ApiProblem, api, errorMessage } from "@fmerp/shared/lib/api";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
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
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { useBusinesses, useDepartments, useDuties, usePositions } from "@/lib/queries";
import {
  type AssignmentHistoryItem,
  type Capabilities,
  GRANT_ROLE_LABEL,
  GRANT_ROLE_SCOPES,
  type GrantRole,
  type Member,
  type MemberStatus,
  SCOPE_LABEL,
  type ScopeType,
  STATUS_LABEL,
} from "@/lib/types";

const NONE = "__none";

interface Row {
  key: string;
  businessId: string;
  departmentId: string;
  positionId: string;
  dutyId: string;
  isPrimary: boolean;
}

const ACTION_LABEL: Record<string, string> = { create: "발령", update: "변경", end: "소속 종료" };

function BasicSection({
  member,
  canStatus,
  canEmpNo,
}: {
  member: Member;
  canStatus: boolean;
  canEmpNo: boolean;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [status, setStatus] = useState<MemberStatus>(member.status);
  const [employeeNo, setEmployeeNo] = useState(member.employeeNo ?? "");

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/api/account/members/${member.userId}`, {
        method: "PATCH",
        body: {
          ...(canStatus && status !== member.status ? { status } : {}),
          ...(canEmpNo && employeeNo !== (member.employeeNo ?? "")
            ? { employeeNo: employeeNo.trim() || null }
            : {}),
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["members"] });
      toast.success("저장했습니다");
    } catch (error) {
      if (error instanceof ApiProblem && error.code === "in_flight") {
        // 처리 전 결재가 남아 있으면 퇴사·휴직 처리가 거부된다: 이관 화면으로 바로 갈 수 있게 한다 (ORG-036)
        toast.error(errorMessage(error), {
          action: {
            label: "결재 이관",
            onClick: () => router.push(`/admin/approvals?from=${member.membershipId}`),
          },
        });
        return;
      }
      toast.error(errorMessage(error));
    }
  }

  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-[12rem_12rem_auto] sm:items-end">
      <div className="space-y-2">
        <Label htmlFor="m-status">상태</Label>
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as MemberStatus)}
          disabled={!canStatus || member.role === "owner"}
        >
          <SelectTrigger id="m-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STATUS_LABEL) as MemberStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {s === "left" ? "퇴사·비활성" : STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="m-empno">사번</Label>
        <Input
          id="m-empno"
          value={employeeNo}
          onChange={(e) => setEmployeeNo(e.target.value)}
          disabled={!canEmpNo}
          maxLength={30}
        />
      </div>
      <Button type="submit" disabled={!canStatus && !canEmpNo}>
        저장
      </Button>
    </form>
  );
}

function AssignmentsSection({ member }: { member: Member }) {
  const queryClient = useQueryClient();
  const { data: businesses } = useBusinesses();
  const { data: departments } = useDepartments();
  const { data: positions } = usePositions();
  const { data: duties } = useDuties();
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<Row[]>(
    member.assignments.map((a) => ({
      key: a.id,
      businessId: a.businessId,
      departmentId: a.departmentId,
      positionId: a.positionId ?? NONE,
      dutyId: a.dutyId ?? NONE,
      isPrimary: a.isPrimary,
    })),
  );

  const update = (key: string, patch: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setPrimary = (key: string) =>
    setRows((list) => list.map((r) => ({ ...r, isPrimary: r.key === key })));

  function addRow() {
    const firstBusiness = businesses?.find((b) => b.active);
    setRows((list) => [
      ...list,
      {
        key: crypto.randomUUID(),
        businessId: firstBusiness?.id ?? "",
        departmentId: "",
        positionId: NONE,
        dutyId: NONE,
        isPrimary: list.length === 0,
      },
    ]);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/api/account/members/${member.userId}/assignments`, {
        method: "PUT",
        body: {
          assignments: rows.map((r) => ({
            businessId: r.businessId,
            departmentId: r.departmentId,
            positionId: r.positionId === NONE ? null : r.positionId,
            dutyId: r.dutyId === NONE ? null : r.dutyId,
            isPrimary: r.isPrimary,
          })),
          reason: reason || undefined,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["members"] });
      await queryClient.invalidateQueries({ queryKey: ["org-chart"] });
      await queryClient.invalidateQueries({ queryKey: ["assignment-history", member.userId] });
      setReason("");
      toast.success("발령을 저장했습니다");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">소속이 없습니다.</p>}
      {rows.map((r, i) => (
        <fieldset key={r.key} className="grid gap-2 rounded-md border p-3 sm:grid-cols-4">
          <legend className="px-1 text-sm font-medium">
            소속 {i + 1} {r.isPrimary && <Badge variant="secondary">주소속</Badge>}
          </legend>
          <div className="space-y-1">
            <Label htmlFor={`a-biz-${r.key}`}>사업자</Label>
            <Select
              value={r.businessId}
              onValueChange={(v) => update(r.key, { businessId: v, departmentId: "" })}
            >
              <SelectTrigger id={`a-biz-${r.key}`} className="w-full">
                <SelectValue placeholder="선택" />
              </SelectTrigger>
              <SelectContent>
                {businesses
                  ?.filter((b) => b.active || b.id === r.businessId)
                  .map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`a-dept-${r.key}`}>부서</Label>
            <Select
              value={r.departmentId}
              onValueChange={(v) => update(r.key, { departmentId: v })}
            >
              <SelectTrigger id={`a-dept-${r.key}`} className="w-full">
                <SelectValue placeholder="선택" />
              </SelectTrigger>
              <SelectContent>
                {departments
                  ?.filter(
                    (d) => d.businessId === r.businessId && (d.active || d.id === r.departmentId),
                  )
                  .map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {"　".repeat(d.depth - 1)}
                      {d.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`a-pos-${r.key}`}>직위</Label>
            <Select value={r.positionId} onValueChange={(v) => update(r.key, { positionId: v })}>
              <SelectTrigger id={`a-pos-${r.key}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>(없음)</SelectItem>
                {positions
                  ?.filter((p) => p.active || p.id === r.positionId)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`a-duty-${r.key}`}>직책</Label>
            <Select value={r.dutyId} onValueChange={(v) => update(r.key, { dutyId: v })}>
              <SelectTrigger id={`a-duty-${r.key}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>(없음)</SelectItem>
                {duties
                  ?.filter((d) => d.active || d.id === r.dutyId)
                  .map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 sm:col-span-4">
            {!r.isPrimary && (
              <Button type="button" size="sm" variant="outline" onClick={() => setPrimary(r.key)}>
                주소속으로 지정
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}
            >
              소속 제거
            </Button>
          </div>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-end gap-3">
        <Button type="button" variant="outline" onClick={addRow}>
          겸직·소속 추가
        </Button>
        <div className="min-w-48 flex-1 space-y-1">
          <Label htmlFor="a-reason">발령 사유 (선택)</Label>
          <Input
            id="a-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
          />
        </div>
        <Button type="submit">발령 저장</Button>
      </div>
    </form>
  );
}

function RolesSection({ member }: { member: Member }) {
  const queryClient = useQueryClient();
  const { data: businesses } = useBusinesses();
  const { data: departments } = useDepartments();
  const [role, setRole] = useState<GrantRole>("hr_admin");
  const [scopeType, setScopeType] = useState<ScopeType>("account");
  const [scopeId, setScopeId] = useState("");
  const allowedScopes = GRANT_ROLE_SCOPES[role];

  function changeRole(next: GrantRole) {
    setRole(next);
    if (!GRANT_ROLE_SCOPES[next].includes(scopeType))
      setScopeType(GRANT_ROLE_SCOPES[next][0] ?? "account");
    setScopeId("");
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["members"] });
    await queryClient.invalidateQueries({ queryKey: ["capabilities"] });
  }

  async function grant(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/api/account/members/${member.userId}/roles`, {
        method: "POST",
        body: { role, scopeType, scopeId: scopeType === "account" ? null : scopeId },
      });
      await refresh();
      toast.success("역할을 부여했습니다");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("이 역할을 회수할까요?")) return;
    try {
      await api(`/api/account/members/${member.userId}/roles/${id}`, { method: "DELETE" });
      await refresh();
      toast.success("역할을 회수했습니다");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className="space-y-3">
      {member.role !== "member" && (
        <p className="text-sm text-muted-foreground">
          {member.role === "owner" ? "소유자" : "계정 관리자"}는 계정 전체 범위의 권한을 가집니다.
        </p>
      )}
      {member.grants.length === 0 ? (
        <p className="text-sm text-muted-foreground">부여된 역할이 없습니다.</p>
      ) : (
        <ul className="space-y-1">
          {member.grants.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">{GRANT_ROLE_LABEL[g.role]}</Badge>
              <span>{g.scopeLabel}</span>
              <Button size="sm" variant="outline" onClick={() => revoke(g.id)}>
                회수
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={grant} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="g-role">역할</Label>
          <Select value={role} onValueChange={(v) => changeRole(v as GrantRole)}>
            <SelectTrigger id="g-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(GRANT_ROLE_LABEL) as GrantRole[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {GRANT_ROLE_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="g-scope">범위</Label>
          <Select
            value={scopeType}
            onValueChange={(v) => {
              setScopeType(v as ScopeType);
              setScopeId("");
            }}
          >
            <SelectTrigger id="g-scope" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allowedScopes.map((s) => (
                <SelectItem key={s} value={s}>
                  {SCOPE_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="g-target">대상</Label>
          <Select value={scopeId} onValueChange={setScopeId} disabled={scopeType === "account"}>
            <SelectTrigger id="g-target" className="w-full">
              <SelectValue placeholder={scopeType === "account" ? "계정 전체" : "선택"} />
            </SelectTrigger>
            <SelectContent>
              {scopeType === "business" &&
                businesses?.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              {scopeType === "department" &&
                departments?.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {"　".repeat(d.depth - 1)}
                    {d.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={scopeType !== "account" && !scopeId}>
          부여
        </Button>
      </form>
    </div>
  );
}

function HistorySection({ member }: { member: Member }) {
  const { data } = useQuery({
    queryKey: ["assignment-history", member.userId],
    queryFn: () =>
      api<AssignmentHistoryItem[]>(`/api/account/members/${member.userId}/assignment-history`),
  });
  if (!data) return null;
  if (data.length === 0)
    return <p className="text-sm text-muted-foreground">발령 이력이 없습니다.</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>발령일</TableHead>
            <TableHead>구분</TableHead>
            <TableHead>사유</TableHead>
            <TableHead>처리자</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((h) => (
            <TableRow key={h.id}>
              <TableCell>{h.effectiveDate}</TableCell>
              <TableCell>{ACTION_LABEL[h.action] ?? h.action}</TableCell>
              <TableCell>{h.reason ?? "-"}</TableCell>
              <TableCell>{h.actorName ?? "-"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** 구성원 한 명의 상태·사번, 소속(겸직)·발령, 역할, 발령 이력 편집 (PRD ORG-032~035, PERM-001). 권한이 없는 부분은 숨긴다 */
export function MemberDetail({
  member,
  caps,
  onClose,
}: {
  member: Member;
  caps: Capabilities;
  onClose: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>
            {member.name}{" "}
            <span className="text-sm font-normal text-muted-foreground">{member.email}</span>
          </span>
          <Button size="sm" variant="outline" onClick={onClose}>
            닫기
          </Button>
        </CardTitle>
        <CardDescription>상태·사번, 소속과 발령, 역할을 관리합니다.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section aria-labelledby="md-basic" className="space-y-2">
          <h2 id="md-basic" className="text-sm font-semibold">
            기본 정보
          </h2>
          <BasicSection
            key={`${member.userId}-${member.status}-${member.employeeNo}`}
            member={member}
            canStatus={Boolean(caps["member.deactivate"])}
            canEmpNo={Boolean(caps["assignment.manage"])}
          />
        </section>
        {caps["assignment.manage"] && (
          <>
            <section aria-labelledby="md-assign" className="space-y-2">
              <h2 id="md-assign" className="text-sm font-semibold">
                소속·겸직
              </h2>
              <AssignmentsSection
                key={`${member.userId}-${member.assignments.map((a) => `${a.id}${a.isPrimary}${a.positionId}${a.dutyId}`).join()}`}
                member={member}
              />
            </section>
            <section aria-labelledby="md-history" className="space-y-2">
              <h2 id="md-history" className="text-sm font-semibold">
                발령 이력
              </h2>
              <HistorySection member={member} />
            </section>
          </>
        )}
        {caps["role.grant"] && (
          <section aria-labelledby="md-roles" className="space-y-2">
            <h2 id="md-roles" className="text-sm font-semibold">
              역할
            </h2>
            <RolesSection member={member} />
          </section>
        )}
      </CardContent>
    </Card>
  );
}

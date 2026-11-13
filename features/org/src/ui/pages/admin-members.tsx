"use client";

import { api, errorMessage } from "@fmerp/shared/lib/api";
import {
  useBusinesses,
  useCapabilities,
  useDepartments,
  useMe,
  useMembers,
} from "@fmerp/shared/lib/queries";
import {
  type Capabilities,
  formatDateTime,
  GRANT_ROLE_LABEL,
  type Invitation,
  type Member,
  ROLE_LABEL,
  STATUS_LABEL,
} from "@fmerp/shared/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@fmerp/shared/ui/alert";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { DataTable, type DataTableColumn } from "@fmerp/shared/ui/data-table";
import { EmptyState } from "@fmerp/shared/ui/empty-state";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@fmerp/shared/ui/tabs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { MemberDetail } from "../components/member-detail";
import { PreRegisterCard } from "../components/pre-register-card";
import { usePositions } from "../queries";

const NONE = "__none";

const INVITATION_STATUS: Record<Invitation["status"], string> = {
  pending: "대기",
  used: "수락됨",
  expired: "만료",
  revoked: "취소",
};

const INVITATION_TONE = {
  pending: "info",
  used: "success",
  expired: "outline",
  revoked: "outline",
} as const;

/** 구성원 목록과 상세 편집: 상태·사번, 소속·발령, 역할 (AUTH-015, ORG-032~035, PERM-001) */
function MembersTab({ caps }: { caps: Capabilities }) {
  const {
    data: members,
    isLoading: membersLoading,
    isError: membersError,
    refetch: refetchMembers,
  } = useMembers();
  const [selected, setSelected] = useState<string | null>(null);
  const current = members?.find((m) => m.userId === selected);

  if (membersError) return <QueryErrorState onRetry={() => void refetchMembers()} />;
  if (membersLoading || !members) return <LoadingState />;

  const columns: DataTableColumn<Member>[] = [
    {
      id: "name",
      header: "이름",
      sortValue: (m) => m.name,
      cell: (m) => (
        <>
          <div className="font-medium">{m.name}</div>
          <div className="text-xs text-muted-foreground">
            {m.employeeNo} · {m.email}
          </div>
        </>
      ),
    },
    {
      id: "dept",
      header: "소속",
      hideBelow: "sm",
      sortValue: (m) => m.assignments.find((a) => a.isPrimary)?.departmentName ?? "",
      cell: (m) => {
        const primary = m.assignments.find((a) => a.isPrimary);
        const extra = m.assignments.length - (primary ? 1 : 0);
        return primary ? (
          <>
            {primary.departmentName}
            {primary.positionName ? ` · ${primary.positionName}` : ""}
            {extra > 0 && <Badge variant="outline">겸직 {extra}</Badge>}
          </>
        ) : (
          <span className="text-muted-foreground">소속 없음</span>
        );
      },
    },
    {
      id: "role",
      header: "역할",
      hideBelow: "md",
      sortValue: (m) => ROLE_LABEL[m.role],
      cell: (m) => (
        <span className="flex flex-wrap items-center gap-1">
          <span>{ROLE_LABEL[m.role]}</span>
          {m.grants.map((g) => (
            <Badge key={g.id} variant="accent">
              {GRANT_ROLE_LABEL[g.role]}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      id: "status",
      header: "상태",
      sortValue: (m) => STATUS_LABEL[m.status],
      cell: (m) => (
        <Badge variant={m.status === "active" ? "success" : "outline"}>
          {STATUS_LABEL[m.status]}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "작업",
      align: "right",
      cell: (m) => (
        <Button
          size="sm"
          variant="outline"
          aria-label={`${m.name} 관리`}
          onClick={() => setSelected(m.userId === selected ? null : m.userId)}
        >
          관리
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PreRegisterCard />
      <DataTable
        rows={members}
        columns={columns}
        rowKey={(m) => m.userId}
        caption="구성원 목록"
        search={{
          placeholder: "이름·사번·이메일·부서 검색 (이전 이름 포함)",
          text: (m) =>
            `${m.name} ${m.formerNames.join(" ")} ${m.employeeNo ?? ""} ${m.email} ${m.formerEmails.join(" ")} ${m.assignments.map((a) => a.departmentName).join(" ")}`,
        }}
        filters={[
          {
            id: "status",
            label: "상태",
            allLabel: "전체 상태",
            options: Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
            predicate: (m, v) => m.status === v,
          },
          {
            id: "role",
            label: "역할",
            allLabel: "전체 역할",
            options: Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label })),
            predicate: (m, v) => m.role === v,
          },
        ]}
        empty={<EmptyState icon={Users} title="구성원이 없습니다" />}
      />
      {current && <MemberDetail member={current} caps={caps} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** 초대 링크 만들기·목록·취소 (AUTH-006). 링크는 만들 때 한 번만 보여 준다 */
function InvitationsTab({ caps }: { caps: Capabilities }) {
  const queryClient = useQueryClient();
  const {
    data: businesses,
    isLoading: businessesLoading,
    isError: businessesError,
    refetch: refetchBusinesses,
  } = useBusinesses();
  const {
    data: departments,
    isLoading: departmentsLoading,
    isError: departmentsError,
    refetch: refetchDepartments,
  } = useDepartments();
  const {
    data: positions,
    isLoading: positionsLoading,
    isError: positionsError,
    refetch: refetchPositions,
  } = usePositions();
  const [businessId, setBusinessId] = useState(NONE);
  const [departmentId, setDepartmentId] = useState(NONE);
  const [positionId, setPositionId] = useState(NONE);
  const [role, setRole] = useState<"member" | "admin">("member");
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const {
    data: invitations,
    isLoading: invitationsLoading,
    isError: invitationsError,
    refetch: refetchInvitations,
  } = useQuery({
    queryKey: ["invitations"],
    queryFn: () => api<Invitation[]>("/api/account/invitations"),
  });

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const created = await api<{ token: string }>("/api/account/invitations", {
        method: "POST",
        body: {
          role,
          email: email || undefined,
          preset:
            businessId !== NONE && departmentId !== NONE
              ? {
                  businessId,
                  departmentId,
                  positionId: positionId === NONE ? null : positionId,
                }
              : undefined,
        },
      });
      setLink(`${window.location.origin}/invite/${created.token}`);
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: ["invitations"] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function revoke(id: string) {
    try {
      await api(`/api/account/invitations/${id}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["invitations"] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    toast.success("초대 링크를 복사했습니다");
  }

  if (businessesError || departmentsError || positionsError || invitationsError) {
    return (
      <QueryErrorState
        onRetry={() => {
          if (businessesError) void refetchBusinesses();
          if (departmentsError) void refetchDepartments();
          if (positionsError) void refetchPositions();
          if (invitationsError) void refetchInvitations();
        }}
      />
    );
  }
  if (
    businessesLoading ||
    departmentsLoading ||
    positionsLoading ||
    invitationsLoading ||
    !businesses ||
    !departments ||
    !positions ||
    !invitations
  ) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">초대 링크 만들기</CardTitle>
          <CardDescription>링크는 7일 동안 1회만 사용할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="invite-role">역할</Label>
              <Select value={role} onValueChange={(v) => setRole(v as "member" | "admin")}>
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">구성원</SelectItem>
                  {caps["role.grant"] && <SelectItem value="admin">관리자</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-email">이메일 (메모용, 선택)</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit">링크 만들기</Button>
            <fieldset className="grid gap-3 sm:col-span-3 sm:grid-cols-3">
              <legend className="mb-1 text-sm text-muted-foreground">
                합류할 소속 미리 지정 (선택)
              </legend>
              <div className="space-y-2">
                <Label htmlFor="invite-business">사업자</Label>
                <Select
                  value={businessId}
                  onValueChange={(v) => {
                    setBusinessId(v);
                    setDepartmentId(NONE);
                  }}
                >
                  <SelectTrigger id="invite-business" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>(지정 안 함)</SelectItem>
                    {businesses
                      .filter((b) => b.active)
                      .map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-dept">부서</Label>
                <Select
                  value={departmentId}
                  onValueChange={setDepartmentId}
                  disabled={businessId === NONE}
                >
                  <SelectTrigger id="invite-dept" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>(선택)</SelectItem>
                    {departments
                      .filter((d) => d.businessId === businessId && d.active)
                      .map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {"　".repeat(d.depth - 1)}
                          {d.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-position">직위</Label>
                <Select
                  value={positionId}
                  onValueChange={setPositionId}
                  disabled={businessId === NONE}
                >
                  <SelectTrigger id="invite-position" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>(없음)</SelectItem>
                    {positions
                      .filter((p) => p.active)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </fieldset>
          </form>
          {link && (
            <Alert>
              <AlertTitle>초대 링크 (지금만 볼 수 있습니다)</AlertTitle>
              <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="break-all text-xs">{link}</code>
                <Button size="sm" variant="secondary" onClick={copy}>
                  복사
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <DataTable
        rows={invitations}
        rowKey={(inv) => inv.id}
        caption="초대 목록"
        columns={[
          { id: "role", header: "역할", cell: (inv) => ROLE_LABEL[inv.role] },
          { id: "email", header: "이메일", hideBelow: "sm", cell: (inv) => inv.email ?? "-" },
          {
            id: "dept",
            header: "지정 소속",
            hideBelow: "md",
            cell: (inv) => departments.find((d) => d.id === inv.preset.departmentId)?.name ?? "-",
          },
          {
            id: "status",
            header: "상태",
            sortValue: (inv) => INVITATION_STATUS[inv.status],
            cell: (inv) => (
              <Badge variant={INVITATION_TONE[inv.status]}>{INVITATION_STATUS[inv.status]}</Badge>
            ),
          },
          {
            id: "expires",
            header: "만료",
            hideBelow: "sm",
            sortValue: (inv) => inv.expiresAt,
            cell: (inv) => formatDateTime(inv.expiresAt),
          },
          {
            id: "actions",
            header: "작업",
            align: "right",
            cell: (inv) =>
              inv.status === "pending" && (
                <Button size="sm" variant="outline" onClick={() => revoke(inv.id)}>
                  취소
                </Button>
              ),
          },
        ]}
        filters={[
          {
            id: "status",
            label: "초대 상태",
            allLabel: "전체 상태",
            options: Object.entries(INVITATION_STATUS).map(([value, label]) => ({ value, label })),
            predicate: (inv, v) => inv.status === v,
          },
        ]}
        empty={<EmptyState title="초대 내역이 없습니다" />}
      />
    </div>
  );
}

export default function MembersPage() {
  const { data: me, isLoading: meLoading, isError: meError, refetch: refetchMe } = useMe();
  const {
    data: caps,
    isLoading: capsLoading,
    isError: capsError,
    refetch: refetchCaps,
  } = useCapabilities(Boolean(me?.activeAccountId));
  if (meError || capsError) {
    return (
      <QueryErrorState
        onRetry={() => {
          if (meError) void refetchMe();
          if (capsError) void refetchCaps();
        }}
      />
    );
  }
  if (meLoading || !me || (me.activeAccountId && (capsLoading || !caps))) return <LoadingState />;
  if (!caps) return <p className="text-muted-foreground">관리 권한이 없습니다.</p>;
  const canMembers = caps["assignment.manage"] || caps["member.deactivate"] || caps["role.grant"];
  const canInvite = caps["member.invite"];
  if (!canMembers && !canInvite) {
    return <p className="text-muted-foreground">구성원을 관리할 권한이 없습니다.</p>;
  }

  return (
    <div>
      <PageHeader title="구성원 관리" breadcrumbs={[{ label: "관리" }, { label: "구성원 관리" }]} />
      <Tabs defaultValue={canMembers ? "members" : "invitations"} className="gap-4">
        <TabsList variant="line">
          {canMembers && <TabsTrigger value="members">구성원</TabsTrigger>}
          {canInvite && <TabsTrigger value="invitations">초대</TabsTrigger>}
        </TabsList>
        {canMembers && (
          <TabsContent value="members">
            <MembersTab caps={caps} />
          </TabsContent>
        )}
        {canInvite && (
          <TabsContent value="invitations">
            <InvitationsTab caps={caps} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

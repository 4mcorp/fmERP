"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { MemberDetail } from "@/components/org/member-detail";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage } from "@/lib/api";
import {
  useBusinesses,
  useCapabilities,
  useDepartments,
  useMe,
  useMembers,
  usePositions,
} from "@/lib/queries";
import {
  type Capabilities,
  formatDateTime,
  GRANT_ROLE_LABEL,
  type Invitation,
  ROLE_LABEL,
  STATUS_LABEL,
} from "@/lib/types";

const NONE = "__none";

const INVITATION_STATUS: Record<Invitation["status"], string> = {
  pending: "대기",
  used: "수락됨",
  expired: "만료",
  revoked: "취소",
};

/** 구성원 목록과 상세 편집: 상태·사번, 소속·발령, 역할 (AUTH-015, ORG-032~035, PERM-001) */
function MembersTab({ caps }: { caps: Capabilities }) {
  const { data: members } = useMembers();
  const [selected, setSelected] = useState<string | null>(null);
  const current = members?.find((m) => m.userId === selected);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="overflow-x-auto pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>소속</TableHead>
                <TableHead>역할</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="text-right">작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members?.map((m) => {
                const primary = m.assignments.find((a) => a.isPrimary);
                const extra = m.assignments.length - (primary ? 1 : 0);
                return (
                  <TableRow key={m.userId}>
                    <TableCell>
                      <div>{m.name}</div>
                      <div className="text-xs text-muted-foreground">{m.email}</div>
                    </TableCell>
                    <TableCell>
                      {primary ? (
                        <>
                          {primary.departmentName}
                          {primary.positionName ? ` · ${primary.positionName}` : ""}
                          {extra > 0 && <Badge variant="outline">겸직 {extra}</Badge>}
                        </>
                      ) : (
                        <span className="text-muted-foreground">소속 없음</span>
                      )}
                    </TableCell>
                    <TableCell className="space-x-1">
                      <span>{ROLE_LABEL[m.role]}</span>
                      {m.grants.map((g) => (
                        <Badge key={g.id} variant="secondary">
                          {GRANT_ROLE_LABEL[g.role]}
                        </Badge>
                      ))}
                    </TableCell>
                    <TableCell>
                      <Badge variant={m.status === "active" ? "secondary" : "outline"}>
                        {STATUS_LABEL[m.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`${m.name} 관리`}
                        onClick={() => setSelected(m.userId === selected ? null : m.userId)}
                      >
                        관리
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {current && <MemberDetail member={current} caps={caps} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** 초대 링크 만들기·목록·취소 (AUTH-006). 링크는 만들 때 한 번만 보여 준다 */
function InvitationsTab({ caps }: { caps: Capabilities }) {
  const queryClient = useQueryClient();
  const { data: businesses } = useBusinesses();
  const { data: departments } = useDepartments();
  const { data: positions } = usePositions();
  const [businessId, setBusinessId] = useState(NONE);
  const [departmentId, setDepartmentId] = useState(NONE);
  const [positionId, setPositionId] = useState(NONE);
  const [role, setRole] = useState<"member" | "admin">("member");
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const { data: invitations } = useQuery({
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
                      ?.filter((b) => b.active)
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
                      ?.filter((d) => d.businessId === businessId && d.active)
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
                      ?.filter((p) => p.active)
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

      <Card>
        <CardContent className="overflow-x-auto pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>역할</TableHead>
                <TableHead>이메일</TableHead>
                <TableHead>지정 소속</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>만료</TableHead>
                <TableHead className="text-right">작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations?.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>{ROLE_LABEL[inv.role]}</TableCell>
                  <TableCell>{inv.email ?? "-"}</TableCell>
                  <TableCell>
                    {departments?.find((d) => d.id === inv.preset.departmentId)?.name ?? "-"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{INVITATION_STATUS[inv.status]}</Badge>
                  </TableCell>
                  <TableCell>{formatDateTime(inv.expiresAt)}</TableCell>
                  <TableCell className="text-right">
                    {inv.status === "pending" && (
                      <Button size="sm" variant="outline" onClick={() => revoke(inv.id)}>
                        취소
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function MembersPage() {
  const { data: me } = useMe();
  const { data: caps } = useCapabilities(Boolean(me?.activeAccountId));
  if (!me || !caps) return null;
  const canMembers = caps["assignment.manage"] || caps["member.deactivate"] || caps["role.grant"];
  const canInvite = caps["member.invite"];
  if (!canMembers && !canInvite) {
    return <p className="text-muted-foreground">구성원을 관리할 권한이 없습니다.</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">구성원 관리</h1>
      <Tabs defaultValue={canMembers ? "members" : "invitations"}>
        <TabsList>
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

"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
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
import { useCurrentAccount, useMe } from "@/lib/queries";
import {
  formatDateTime,
  type Invitation,
  type Member,
  ROLE_LABEL,
  STATUS_LABEL,
} from "@/lib/types";

const INVITATION_STATUS: Record<Invitation["status"], string> = {
  pending: "대기",
  used: "수락됨",
  expired: "만료",
  revoked: "취소",
};

/** 구성원 비활성화·복귀 (AUTH-015) */
function MembersTab({ myId }: { myId: string }) {
  const queryClient = useQueryClient();
  const { data: members } = useQuery({
    queryKey: ["members"],
    queryFn: () => api<Member[]>("/api/account/members"),
  });

  async function setStatus(member: Member, status: "active" | "left") {
    try {
      await api(`/api/account/members/${member.userId}`, { method: "PATCH", body: { status } });
      await queryClient.invalidateQueries({ queryKey: ["members"] });
      toast.success(
        status === "left"
          ? `${member.name}님을 비활성화했습니다`
          : `${member.name}님을 복귀시켰습니다`,
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Card>
      <CardContent className="overflow-x-auto pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead>이메일</TableHead>
              <TableHead>역할</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members?.map((m) => (
              <TableRow key={m.userId}>
                <TableCell>{m.name}</TableCell>
                <TableCell>{m.email}</TableCell>
                <TableCell>{ROLE_LABEL[m.role]}</TableCell>
                <TableCell>
                  <Badge variant={m.status === "active" ? "secondary" : "outline"}>
                    {STATUS_LABEL[m.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {m.userId !== myId &&
                    (m.status === "left" ? (
                      <Button size="sm" variant="outline" onClick={() => setStatus(m, "active")}>
                        복귀
                      </Button>
                    ) : (
                      <Button size="sm" variant="destructive" onClick={() => setStatus(m, "left")}>
                        비활성화
                      </Button>
                    ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** 초대 링크 만들기·목록·취소 (AUTH-006). 링크는 만들 때 한 번만 보여 준다 */
function InvitationsTab() {
  const queryClient = useQueryClient();
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
        body: { role, email: email || undefined },
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
                  <SelectItem value="admin">관리자</SelectItem>
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
  const { data: account } = useCurrentAccount(Boolean(me?.activeAccountId));
  if (!me || !account) return null;
  if (account.myRole === "member") {
    return <p className="text-muted-foreground">소유자·관리자만 구성원을 관리할 수 있습니다.</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">구성원 관리</h1>
      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">구성원</TabsTrigger>
          <TabsTrigger value="invitations">초대</TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <MembersTab myId={me.id} />
        </TabsContent>
        <TabsContent value="invitations">
          <InvitationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

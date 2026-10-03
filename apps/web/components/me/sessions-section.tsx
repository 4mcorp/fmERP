"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, type LoginHistoryItem, type SessionInfo } from "@/lib/types";

const ACTION_LABEL: Record<string, string> = {
  "auth.login": "로그인",
  "auth.logout": "로그아웃",
  "auth.session_expired": "세션 만료",
};

/** 활성 세션 조회·강제 종료 (AUTH-008) */
export function SessionsSection() {
  const queryClient = useQueryClient();
  const { data: sessions } = useQuery({
    queryKey: ["me-sessions"],
    queryFn: () => api<SessionInfo[]>("/api/me/sessions"),
  });

  async function revoke(session: SessionInfo) {
    try {
      await api(`/api/me/sessions/${session.id}`, { method: "DELETE" });
      if (session.current) {
        window.location.href = "/dev-login";
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["me-sessions"] });
      toast.success("세션을 종료했습니다");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>활성 세션</CardTitle>
        <CardDescription>
          2시간 동안 활동이 없거나 로그인 후 12시간이 지나면 만료됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>접속 환경</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>마지막 활동</TableHead>
              <TableHead className="text-right">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions?.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="max-w-56 truncate" title={s.userAgent ?? undefined}>
                  {s.current && <Badge className="mr-2">현재</Badge>}
                  {s.userAgent ?? "알 수 없음"}
                </TableCell>
                <TableCell>{s.ipAddress ?? "-"}</TableCell>
                <TableCell>{formatDateTime(s.lastActiveAt)}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => revoke(s)}>
                    종료
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** 로그인 이력 (AUTH-013) */
export function LoginHistorySection() {
  const { data: history } = useQuery({
    queryKey: ["me-login-history"],
    queryFn: () => api<LoginHistoryItem[]>("/api/me/login-history"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>로그인 이력</CardTitle>
        <CardDescription>최근 50건</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>일시</TableHead>
              <TableHead>구분</TableHead>
              <TableHead>결과</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history?.map((h) => (
              <TableRow key={`${h.occurredAt}-${h.action}`}>
                <TableCell>{formatDateTime(h.occurredAt)}</TableCell>
                <TableCell>{ACTION_LABEL[h.action] ?? h.action}</TableCell>
                <TableCell>
                  <Badge variant={h.result === "success" ? "secondary" : "destructive"}>
                    {h.result === "success" ? "성공" : "실패"}
                  </Badge>
                </TableCell>
                <TableCell>{h.ip ?? "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

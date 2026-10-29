"use client";

import { api, errorMessage } from "@fmerp/shared/lib/api";
import { formatDateTime } from "@fmerp/shared/lib/types";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { ConfirmDialog } from "@fmerp/shared/ui/confirm-dialog";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { authClient, usePasskeySupport } from "../lib/auth-client";

type Passkey = {
  id: string;
  name: string | null;
  deviceType: string;
  backedUp: boolean;
  createdAt: string | null;
};

/** 내 기기(passkey) 목록·이름 변경·삭제·이 기기 추가 (PK2). 마지막 1개는 서버가 거부한다 */
export function PasskeySection() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Passkey | null>(null);
  const [adding, setAdding] = useState(false);
  const supported = usePasskeySupport();
  const { data: passkeys } = useQuery({
    queryKey: ["me-passkeys"],
    queryFn: () => api<Passkey[]>("/api/me/passkeys"),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["me-passkeys"] });
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    try {
      await api(`/api/me/passkeys/${editing.id}`, {
        method: "PATCH",
        body: { name: editing.name },
      });
      setEditing(null);
      await refresh();
      toast.success("기기 이름을 바꿨습니다");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function remove(passkey: Passkey) {
    try {
      await api(`/api/me/passkeys/${passkey.id}`, { method: "DELETE" });
      await refresh();
      toast.success("기기를 삭제했습니다");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function addThisDevice() {
    setAdding(true);
    try {
      const { error } = await authClient.passkey.addPasskey({
        name: `이 기기 ${new Date().toLocaleDateString("ko-KR")}`,
      });
      if (error) {
        toast.error("이 기기를 추가하지 못했습니다. 기기 잠금 해제를 확인하고 다시 시도하세요");
        return;
      }
      await refresh();
      toast.success("이 기기를 추가했습니다");
    } finally {
      setAdding(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>내 기기 (패스키)</CardTitle>
        <CardDescription>
          패스키를 등록한 기기로 비밀번호 없이 로그인합니다. 마지막 기기는 삭제할 수 없습니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2" aria-label="등록된 기기">
          {passkeys?.map((p) => (
            <li key={p.id} className="rounded-lg border p-3">
              {editing?.id === p.id ? (
                <form onSubmit={rename} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1 space-y-2">
                    <Label htmlFor={`pk-name-${p.id}`}>기기 이름</Label>
                    <Input
                      id={`pk-name-${p.id}`}
                      value={editing.name}
                      maxLength={100}
                      required
                      onChange={(e) => setEditing({ id: p.id, name: e.target.value })}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm">
                      저장
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(null)}
                    >
                      취소
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{p.name ?? "이름 없는 기기"}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.deviceType === "multiDevice" ? "여러 기기 동기화" : "이 기기 전용"}
                      {p.createdAt ? ` · 등록 ${formatDateTime(p.createdAt)}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`${p.name ?? "기기"} 이름 변경`}
                      onClick={() => setEditing({ id: p.id, name: p.name ?? "" })}
                    >
                      이름 변경
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`${p.name ?? "기기"} 삭제`}
                      onClick={() => setPendingDelete(p)}
                    >
                      삭제
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
        {supported === false ? (
          <p className="text-sm text-muted-foreground">
            이 브라우저는 패스키를 지원하지 않아 기기를 추가할 수 없습니다.
          </p>
        ) : (
          <Button onClick={addThisDevice} disabled={adding || supported !== true}>
            {adding ? "추가하는 중…" : "이 기기 추가 등록"}
          </Button>
        )}
      </CardContent>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="이 기기를 삭제할까요?"
        description="삭제하면 이 기기로는 로그인할 수 없습니다."
        confirmLabel="삭제"
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) void remove(target);
        }}
      />
    </Card>
  );
}

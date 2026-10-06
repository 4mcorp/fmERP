"use client";

import { api, errorMessage } from "@fmerp/shared/lib/api";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

const pinInput = {
  type: "password",
  inputMode: "numeric",
  autoComplete: "off",
  pattern: "\\d{6,12}",
  minLength: 6,
  maxLength: 12,
  required: true,
} as const;

/** 결재 PIN 설정·변경·확인 (AUTH-009). 숫자 6~12자리, 5회 실패 시 15분 잠금 */
export function PinSection({ hasPin }: { hasPin: boolean }) {
  const queryClient = useQueryClient();
  const [currentPin, setCurrentPin] = useState("");
  const [pin, setPin] = useState("");
  const [checkPin, setCheckPin] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/me/pin", {
        method: "PUT",
        body: { pin, currentPin: hasPin ? currentPin : undefined },
      });
      setPin("");
      setCurrentPin("");
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success(hasPin ? "PIN을 변경했습니다" : "PIN을 설정했습니다");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/me/pin/verify", { method: "POST", body: { pin: checkPin } });
      setCheckPin("");
      toast.success("PIN이 확인되었습니다. 30분 동안 결재 시 다시 묻지 않습니다");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>결재 PIN</CardTitle>
        <CardDescription>
          결재·백업 다운로드 같은 중요한 작업 전에 본인을 다시 확인합니다. 숫자 6~12자리이며, 5회
          틀리면 15분 동안 잠깁니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          {hasPin && (
            <div className="space-y-2">
              <Label htmlFor="pin-current">현재 PIN</Label>
              <Input
                id="pin-current"
                {...pinInput}
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="pin-new">{hasPin ? "새 PIN" : "PIN"}</Label>
            <Input
              id="pin-new"
              {...pinInput}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </div>
          <Button type="submit">{hasPin ? "변경" : "설정"}</Button>
        </form>

        {hasPin && (
          <form onSubmit={verify} className="flex items-end gap-2">
            <div className="flex-1 space-y-2">
              <Label htmlFor="pin-check">PIN 확인 테스트</Label>
              <Input
                id="pin-check"
                {...pinInput}
                value={checkPin}
                onChange={(e) => setCheckPin(e.target.value)}
              />
            </div>
            <Button type="submit" variant="secondary">
              확인
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "../lib/api";
import { Button } from "./button";
import { Input } from "./input";
import { Label } from "./label";

/** 결재 PIN 입력칸 공통 속성: 숫자 6~12자리 (AUTH-009) */
export const PIN_INPUT_PROPS = {
  type: "password",
  inputMode: "numeric",
  autoComplete: "off",
  pattern: "\\d{6,12}",
  minLength: 6,
  maxLength: 12,
  required: true,
} as const;

/** 새 결재 PIN과 확인 입력이 일치할 때만 저장한다. */
export function PinSetupForm({
  onSaved,
  onCancel,
  idPrefix = "pin-setup",
  submitLabel = "설정",
}: {
  onSaved: () => void;
  onCancel?: () => void;
  idPrefix?: string;
  submitLabel?: string;
}) {
  const queryClient = useQueryClient();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (pin !== confirm) {
      setError("PIN이 서로 일치하지 않습니다");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/api/me/pin", { method: "PUT", body: { pin } });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("PIN을 설정했습니다");
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-new`}>새 PIN (숫자 6~12자리)</Label>
        <Input
          id={`${idPrefix}-new`}
          {...PIN_INPUT_PROPS}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          aria-invalid={error !== null}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-confirm`}>PIN 다시 입력</Label>
        <Input
          id={`${idPrefix}-confirm`}
          {...PIN_INPUT_PROPS}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={error !== null}
          aria-describedby={error ? `${idPrefix}-error` : undefined}
        />
        {error && (
          <p id={`${idPrefix}-error`} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            취소
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? "저장 중…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

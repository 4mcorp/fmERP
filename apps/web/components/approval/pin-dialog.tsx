"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { api, errorMessage } from "@/lib/api";

/**
 * 결재 PIN 재인증 대화상자 (AUTH-009, APV-043). 확인에 성공하면 30분 동안 다시 묻지 않는다.
 * PIN이 아직 없으면 내 정보에서 먼저 설정하도록 안내한다.
 */
export function PinDialog({
  open,
  needsSetup,
  onClose,
  onVerified,
  description,
  setupDescription,
}: {
  open: boolean;
  needsSetup: boolean;
  onClose: () => void;
  onVerified: () => void;
  /** 확인 안내 문구. 결재 처리가 아닌 곳(백업·내보내기)에서 바꿔 쓴다 */
  description?: string;
  setupDescription?: string;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/me/pin/verify", { method: "POST", body: { pin } });
      setPin("");
      onVerified();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        setPin("");
        setError(null);
        onClose();
      }}
      title={needsSetup ? "결재 PIN 설정이 필요합니다" : "결재 PIN 확인"}
      description={
        needsSetup
          ? (setupDescription ?? "결재를 처리하려면 먼저 내 정보에서 결재 PIN을 설정하세요.")
          : (description ??
            "결재를 처리하기 전에 본인 확인을 위해 결재 PIN을 입력하세요. 확인 후 30분 동안은 다시 묻지 않습니다.")
      }
    >
      {needsSetup ? (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
          <Button asChild>
            <Link href="/me">내 정보에서 설정</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="reauth-pin">결재 PIN</Label>
            <Input
              id="reauth-pin"
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              minLength={6}
              maxLength={12}
              required
              aria-invalid={error !== null}
              aria-describedby={error ? "reauth-pin-error" : undefined}
            />
            {error && (
              <p id="reauth-pin-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "확인 중…" : "확인하고 계속"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

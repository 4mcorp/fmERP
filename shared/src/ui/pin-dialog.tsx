"use client";

import { type FormEvent, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { Button } from "./button";
import { Input } from "./input";
import { Label } from "./label";
import { Modal } from "./modal";
import { PIN_INPUT_PROPS, PinSetupForm } from "./pin-setup-form";

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
  onPinSetup,
}: {
  open: boolean;
  needsSetup: boolean;
  onClose: () => void;
  onVerified: () => void;
  /** 확인 안내 문구. 결재 처리가 아닌 곳(백업·내보내기)에서 바꿔 쓴다 */
  description?: string;
  setupDescription?: string;
  /** PIN 설정 성공 후 후속 화면 진입 처리. 생략 시 대화상자만 닫는다 */
  onPinSetup?: () => void;
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
        <div className="space-y-3">
          <PinSetupForm
            onSaved={() => {
              onClose();
              onPinSetup?.();
            }}
            onCancel={onClose}
            idPrefix="reauth-setup"
            submitLabel="설정하고 계속"
          />
        </div>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="reauth-pin">결재 PIN</Label>
            <Input
              id="reauth-pin"
              {...PIN_INPUT_PROPS}
              autoComplete="one-time-code"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
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

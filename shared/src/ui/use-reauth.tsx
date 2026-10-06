"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ApiProblem, errorMessage } from "../lib/api";
import { PinDialog } from "./pin-dialog";

/**
 * 백업·내보내기 동작의 PIN 재인증 흐름: 동작을 실행하다 428이 오면 PIN 창을 띄우고, 확인되면 같은 동작을 다시 실행한다.
 * 다른 오류는 토스트로 알린다.
 */
export function useReauth() {
  const [pin, setPin] = useState<{ needsSetup: boolean } | null>(null);
  const retry = useRef<(() => Promise<void>) | null>(null);

  async function run(task: () => Promise<void>) {
    try {
      await task();
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 428) {
        retry.current = task;
        setPin({ needsSetup: error.code === "pin_not_set" });
        return;
      }
      toast.error(errorMessage(error));
    }
  }

  const dialog = (
    <PinDialog
      open={pin !== null}
      needsSetup={pin?.needsSetup ?? false}
      description="데이터를 내보내거나 내려받기 전에 본인 확인을 위해 결재 PIN을 입력하세요. 확인 후 30분 동안은 다시 묻지 않습니다."
      setupDescription="백업·내보내기를 하려면 먼저 내 정보에서 결재 PIN을 설정하세요."
      onClose={() => {
        retry.current = null;
        setPin(null);
      }}
      onVerified={() => {
        const task = retry.current;
        retry.current = null;
        setPin(null);
        if (task) void run(task);
      }}
    />
  );

  return { run, dialog };
}

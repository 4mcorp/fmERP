"use client";

import { useState } from "react";
import { Button } from "./button";
import { Modal } from "./modal";

/**
 * 되돌리기 어려운 동작 앞의 확인 창. `window.confirm` 대신 접근 가능한 `Modal`을 쓴다.
 * `onConfirm`이 Promise를 돌려주면 끝날 때까지 두 버튼을 비활성화하고, 끝난 뒤에 닫는다.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm: () => unknown;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
      onClose();
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!pending) onClose();
      }}
      title={title}
      description={description}
    >
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={pending}>
          취소
        </Button>
        <Button variant="destructive" onClick={() => void confirm()} disabled={pending}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

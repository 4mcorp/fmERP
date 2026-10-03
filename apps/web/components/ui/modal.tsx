"use client";

import { cn } from "cn";
import { type ReactNode, useEffect, useId, useRef } from "react";

/**
 * 브라우저 기본 `<dialog>` 기반 모달 (포커스 가두기·Esc 닫기는 브라우저가 처리한다).
 * shadcn CLI(dlx)가 이 저장소의 strict peer 설정에서 실행되지 않아 필요한 만큼만 직접 만들었다.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 배경 클릭 닫기는 보조 수단이며 Esc는 <dialog>가 처리한다
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // 바깥(배경) 클릭으로 닫기
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby={titleId}
      className={cn(
        "m-auto w-[min(32rem,calc(100vw-2rem))] overscroll-contain rounded-xl border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/40",
        className,
      )}
    >
      {open && (
        <div className="space-y-4 p-5">
          <div className="space-y-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

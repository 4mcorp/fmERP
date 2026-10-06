"use client";

import { cn } from "cn";
import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

/**
 * 모달(`<dialog>`) 안에서 열리는 드롭다운(Radix Select)은 body에 그려지면 모달 바깥이라 클릭이 막힌다.
 * 모달이 자기 요소를 알려 주면 `SelectContent`가 그 안에 그린다.
 */
export const ModalContainerContext = createContext<HTMLElement | null>(null);

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
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();
  // 렌더마다 새 함수를 주면 React가 ref를 null→요소로 계속 다시 호출해 상태 갱신이 끝없이 이어진다
  const setRef = useCallback((el: HTMLDialogElement | null) => {
    ref.current = el;
    setContainer(el);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 배경 클릭 닫기는 보조 수단이며 Esc는 <dialog>가 처리한다
    <dialog
      ref={setRef}
      onClose={onClose}
      onClick={(e) => {
        // 바깥(배경) 클릭으로 닫기. 클릭 대상이 dialog 자신이어도 위치가 대화상자 안이면 배경 클릭이 아니다:
        // 안쪽 드롭다운을 누르면 mousedown(트리거)과 mouseup(펼쳐진 목록) 대상이 달라 클릭이 공통 조상인 dialog로 온다
        const el = ref.current;
        if (e.target !== el || !el) return;
        const r = el.getBoundingClientRect();
        const inside =
          e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom;
        if (!inside) onClose();
      }}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
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
            {description && (
              <p id={descId} className="text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          <ModalContainerContext.Provider value={container}>
            {children}
          </ModalContainerContext.Provider>
        </div>
      )}
    </dialog>
  );
}

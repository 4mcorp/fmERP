"use client";

import { cn } from "cn";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Badge } from "./badge";

/** 접힘 상태의 본문 클래스. 인쇄(print)에서는 접혀 있어도 항상 펼친다 */
export function collapsibleBodyClass(open: boolean): string {
  return open ? "" : "hidden print:block";
}

/** 머리줄 전체가 토글 버튼. 접히면 카드 높이는 머리줄 1줄 */
export function CollapsibleCard({
  title,
  description,
  defaultOpen = false,
  count,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  defaultOpen?: boolean;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section
      data-slot="collapsible-card"
      data-state={open ? "open" : "closed"}
      className={cn(
        "rounded-xl bg-card text-sm text-card-foreground ring-1 ring-foreground/10",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-tl-xl px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform print:hidden",
              open && "rotate-180",
            )}
          />
          <span className="shrink-0 font-heading text-base leading-snug font-medium whitespace-nowrap">
            {title}
          </span>
          {count !== undefined && <Badge variant="secondary">{count}</Badge>}
          {description && (
            <span className="min-w-0 truncate text-sm text-muted-foreground">{description}</span>
          )}
        </button>
        {actions && <div className="shrink-0 py-3 pr-4 print:hidden">{actions}</div>}
      </div>
      <div id={bodyId} className={cn("px-4 pb-4", collapsibleBodyClass(open))}>
        {children}
      </div>
    </section>
  );
}

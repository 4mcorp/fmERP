import { cn } from "cn";
import type * as React from "react";

/**
 * 페이지 action 줄. 주 동작(상신·다음·적용·저장·확인)은 맨 오른쪽 variant="default",
 * 보조(취소·이전·초기화)는 그 왼쪽 outline/ghost, 위험 동작은 destructive.
 */
function ActionBar({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div
      data-slot="action-bar"
      className={cn("flex flex-wrap items-center justify-end gap-2", className)}
    >
      {children}
    </div>
  );
}

export { ActionBar };

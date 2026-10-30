import { cn } from "cn";
import type * as React from "react";

/** 열 수: 기본 1, md 2, xl 3, 2xl 4, 1920px 이상 5(최대) */
export const CARD_GRID_CLASS =
  "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 min-[120rem]:grid-cols-5";
/** 한 행 전체(1열)를 차지하는 카드 래퍼 */
export const CARD_GRID_FULL_CLASS = "col-span-full";

function CardGrid({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div data-slot="card-grid" className={cn(CARD_GRID_CLASS, className)}>
      {children}
    </div>
  );
}

function CardGridFull({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div data-slot="card-grid-full" className={cn(CARD_GRID_FULL_CLASS, className)}>
      {children}
    </div>
  );
}

CardGrid.Full = CardGridFull;

export { CardGrid };

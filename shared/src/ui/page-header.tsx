import { cn } from "cn";
import type { ReactNode } from "react";
import { Breadcrumb, type BreadcrumbItem } from "./breadcrumb";

export type PageHeaderProps = {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  /** 오른쪽 액션 묶음. 주 액션(default Button) 1개를 가장 오른쪽에 둔다 */
  actions?: ReactNode;
  className?: string;
};

/** 모든 페이지 공통 제목 영역. `title`은 페이지의 유일한 `<h1>` */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-center justify-between gap-3 pb-4", className)}>
      <div className="min-w-0 flex-1 basis-60">
        {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumb items={breadcrumbs} />}
        <h1 className="break-words text-xl font-semibold">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && (
        <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">{actions}</div>
      )}
    </header>
  );
}

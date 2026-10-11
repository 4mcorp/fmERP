import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export type BreadcrumbItem = { label: string; href?: string };

type LinkProps = { href: string; className: string; children: ReactNode };

const LINK_CLASS = "inline-block py-2 hover:text-foreground hover:underline";

/** 현재 위치 표시. 마지막 항목은 현재 페이지. 모바일에서 3개를 넘으면 가운데를 `…`로 줄인다 */
export function Breadcrumb({
  items,
  renderLink = (p) => <a {...p} />,
  className,
}: {
  items: BreadcrumbItem[];
  renderLink?: (p: LinkProps) => ReactNode;
  className?: string;
}) {
  const collapse = items.length > 3;
  return (
    <nav aria-label="현재 위치" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          // 모바일: 첫 항목과 마지막 두 항목만 보인다
          const hiddenOnMobile = collapse && i > 0 && i < items.length - 2;
          return (
            <li
              key={item.href ?? item.label}
              className={cn("items-center gap-1", hiddenOnMobile ? "hidden sm:flex" : "flex")}
            >
              {i > 0 && <ChevronRight className="size-3 shrink-0" aria-hidden />}
              {collapse && i === 1 && (
                <span className="sm:hidden" aria-hidden>
                  …
                  <ChevronRight className="ml-1 inline size-3" aria-hidden />
                </span>
              )}
              {last || !item.href ? (
                <span
                  aria-current={last ? "page" : undefined}
                  className={cn("py-2", last && "font-medium text-foreground")}
                >
                  {item.label}
                </span>
              ) : (
                renderLink({ href: item.href, className: LINK_CLASS, children: item.label })
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

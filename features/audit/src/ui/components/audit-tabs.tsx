"use client";

import { cn } from "@fmerp/shared/lib/utils";
import { Badge } from "@fmerp/shared/ui/badge";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuditReviews } from "../queries";

const TABS = [
  { href: "/admin/audit", label: "로그 조회" },
  { href: "/admin/audit/review", label: "월간 점검" },
] as const;

/** 감사 로그 화면의 하위 이동: 로그 조회와 월간 접속 기록 점검 */
export function AuditTabs() {
  const pathname = usePathname();
  const { data: reviews } = useAuditReviews(true);
  return (
    <nav aria-label="감사 로그 메뉴" className="flex gap-1 border-b">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              active
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.href === "/admin/audit/review" && reviews?.overdue && (
              <Badge variant="destructive" className="ml-1.5">
                점검 필요
              </Badge>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

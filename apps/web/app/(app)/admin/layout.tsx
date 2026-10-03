"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useCapabilities, useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin/settings", label: "계정 설정", any: ["account.settings"] },
  { href: "/admin/businesses", label: "사업자", any: ["business.create"] },
  { href: "/admin/org", label: "조직", any: ["department.edit"] },
  {
    href: "/admin/members",
    label: "구성원",
    any: ["member.invite", "member.deactivate", "assignment.manage", "role.grant"],
  },
  { href: "/admin/positions", label: "직위·직책", any: ["position.manage"] },
  { href: "/admin/forms", label: "양식", any: ["form.manage"] },
] as const;

/** 관리 콘솔 공통 레이아웃: 내가 쓸 수 있는 메뉴만 보여 준다 (실제 권한은 서버가 판정한다) */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: me } = useMe();
  const { data: caps } = useCapabilities(Boolean(me?.activeAccountId));
  if (!caps) return null;
  const items = NAV.filter((n) => n.any.some((a) => caps[a]));
  if (items.length === 0) {
    return <p className="text-muted-foreground">관리 콘솔을 사용할 권한이 없습니다.</p>;
  }

  return (
    <div className="space-y-4">
      <nav aria-label="관리 콘솔" className="flex gap-1 overflow-x-auto border-b pb-2">
        {items.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={pathname === n.href ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-sm hover:bg-muted",
              pathname === n.href && "bg-muted font-medium",
            )}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}

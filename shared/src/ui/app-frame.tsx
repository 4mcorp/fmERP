"use client";

import { cn } from "cn";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Badge } from "./badge";
import { Button } from "./button";
import { Separator } from "./separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "./sheet";

// 아이콘 타입. lucide-react 컴포넌트를 그대로 받는다 (문자열 키 금지)
type NavIcon = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

export type NavItem = {
  href: string;
  label: string;
  icon?: NavIcon;
  /** 0/undefined면 숨긴다 */
  count?: number;
  /** 스크린리더용 건수 접미사. 기본 "건" */
  countLabelSuffix?: string;
  /** 건수 배지 색. 기본 default(secondary) */
  tone?: "default" | "info";
  /** 활성 판정. 기본 prefix */
  match?: "prefix" | "exact";
};
export type NavSection = { id: string; label?: string; items: NavItem[] };

export type RenderLinkProps = {
  href: string;
  className: string;
  "aria-current"?: "page";
  title?: string;
  "aria-label"?: string;
  children: ReactNode;
};

export type AppFrameProps = {
  /** 사이드바/상단 바 로고 영역 (링크 포함해서 넘긴다) */
  brand: ReactNode;
  /** 합성 루트가 주입하는 내비게이션 */
  nav: NavSection[];
  /** 활성 판정용. 합성 루트가 usePathname() 결과를 넘긴다 */
  pathname: string;
  /** 사이드바 상단의 회사 전환 등 */
  switcher?: ReactNode;
  /** 상단 바 오른쪽 (알림, 사용자 메뉴) */
  topbarEnd?: ReactNode;
  /** 링크 렌더러. 합성 루트가 next/link를 끼운다. 기본 `<a>` */
  renderLink?: (props: RenderLinkProps) => ReactNode;
  children: ReactNode;
};

const COLLAPSED_KEY = "fmerp.sidebar.collapsed";

const defaultRenderLink = ({ children, ...rest }: RenderLinkProps) => <a {...rest}>{children}</a>;

function isActive(item: NavItem, pathname: string) {
  if (item.match === "exact") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function SidebarNav({
  nav,
  pathname,
  renderLink,
  collapsed,
  touch,
}: {
  nav: NavSection[];
  pathname: string;
  renderLink: (props: RenderLinkProps) => ReactNode;
  collapsed: boolean;
  /** 모바일 드로어: 터치 영역 44px */
  touch: boolean;
}) {
  return (
    <nav aria-label="주 메뉴" className="flex flex-col px-2 pb-4">
      {nav.map((section, si) => (
        <div key={section.id} className="flex flex-col gap-0.5">
          {section.label &&
            (collapsed ? (
              si > 0 && <Separator className="my-2" />
            ) : (
              <p className="px-2.5 pt-4 pb-1 text-xs font-medium text-muted-foreground">
                {section.label}
              </p>
            ))}
          {!section.label && si > 0 && <Separator className="my-2" />}
          {section.items.map((item) => {
            const active = isActive(item, pathname);
            const Icon = item.icon;
            const hasCount = Boolean(item.count);
            return (
              <div key={item.href}>
                {renderLink({
                  href: item.href,
                  "aria-current": active ? "page" : undefined,
                  title: collapsed ? item.label : undefined,
                  "aria-label": collapsed
                    ? hasCount
                      ? `${item.label}, ${item.count}${item.countLabelSuffix ?? "건"}`
                      : item.label
                    : undefined,
                  className: cn(
                    "relative flex items-center gap-2.5 rounded-md px-2.5 text-sm hover:bg-sidebar-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                    touch ? "h-11" : "h-9",
                    collapsed && "justify-center px-0",
                    active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                  ),
                  children: (
                    <>
                      {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {hasCount &&
                        (collapsed ? (
                          <span
                            className="absolute top-1 right-1 size-2 rounded-full bg-primary"
                            aria-hidden
                          />
                        ) : (
                          <Badge
                            variant={item.tone === "info" ? "default" : "secondary"}
                            className="ml-auto"
                          >
                            {item.count}
                            <span className="sr-only">{item.countLabelSuffix ?? "건"}</span>
                          </Badge>
                        ))}
                    </>
                  ),
                })}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/**
 * 앱 공통 틀: 데스크톱(lg 이상)은 접을 수 있는 좌측 사이드바 + 얇은 상단 바,
 * 그 아래 폭은 상단 바(h-14) + 왼쪽 드로어. feature를 알지 못하며 내비게이션은 props로 받는다.
 */
export function AppFrame({
  brand,
  nav,
  pathname,
  switcher,
  topbarEnd,
  renderLink = defaultRenderLink,
  children,
}: AppFrameProps) {
  // 서버 렌더와 맞추기 위해 처음에는 펼침, 마운트 후 저장값을 반영한다
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // 저장소를 못 쓰면 펼침 유지
    }
  }, []);

  // 이동하면 드로어를 닫는다 (렌더 중 상태 조정 패턴)
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    setDrawerOpen(false);
  }

  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      } catch {
        // 무시
      }
      return !c;
    });
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[auto_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        본문으로 건너뛰기
      </a>

      {/* 데스크톱 사이드바 */}
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex",
          collapsed ? "w-14" : "w-60",
        )}
      >
        <div
          className={cn("flex h-12 shrink-0 items-center px-4", collapsed && "justify-center px-0")}
        >
          {collapsed ? <span className="sr-only">{brand}</span> : brand}
        </div>
        {switcher && !collapsed && <div className="px-2 pb-2">{switcher}</div>}
        <SidebarNav
          nav={nav}
          pathname={pathname}
          renderLink={renderLink}
          collapsed={collapsed}
          touch={false}
        />
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* 상단 바: 데스크톱 h-12(접기 버튼 + 오른쪽 영역), 모바일 h-14(메뉴 + 로고 + 오른쪽 영역) */}
        <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background px-3 lg:h-12">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="메뉴 열기">
                <Menu aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="gap-0 bg-sidebar text-sidebar-foreground">
              <SheetTitle className="px-4 pt-4 pb-2">메뉴</SheetTitle>
              <SheetDescription className="sr-only">주 메뉴와 회사 전환</SheetDescription>
              {switcher && <div className="px-2 pb-2">{switcher}</div>}
              <SidebarNav
                nav={nav}
                pathname={pathname}
                renderLink={renderLink}
                collapsed={false}
                touch
              />
            </SheetContent>
          </Sheet>
          <div className="lg:hidden">{brand}</div>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            onClick={toggle}
            aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
          </Button>
          <div className="flex-1" />
          {topbarEnd}
        </div>

        <main id="main" className="min-w-0 flex-1 p-4 sm:p-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

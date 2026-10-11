import { cn } from "@fmerp/shared/lib/utils";
import type { ReactNode } from "react";

/** 사이드바가 없는 인증 화면(로그인·개발용 로그인) 공용 레이아웃. `title`이 페이지의 유일한 `<h1>` */
export function AuthLayout({
  title,
  description,
  wide,
  children,
}: {
  title: string;
  description?: string;
  /** 목록처럼 넓은 내용이 있을 때 */
  wide?: boolean;
  children?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center bg-muted/40 px-4 py-10 sm:justify-center">
      <div className={cn("flex w-full flex-col gap-6", wide ? "max-w-2xl" : "max-w-md")}>
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span
            aria-hidden
            className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm text-primary-foreground"
          >
            4m
          </span>
          4mERP
        </div>
        <header className="flex flex-col gap-1">
          <h1 className="break-words text-xl font-semibold">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </header>
        {children}
      </div>
    </main>
  );
}

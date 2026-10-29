import { PageHeader } from "@fmerp/shared/ui/page-header";
import type { ReactNode } from "react";

export type ApprovalPageLayoutProps = {
  title: string;
  children: ReactNode;
  description?: string;
  actions?: ReactNode;
};

/** 결재 기능 페이지 공통 레이아웃. 제목 영역은 PageHeader를 쓰고, 본문은 children이 채운다. */
export function ApprovalPageLayout({
  title,
  children,
  description,
  actions,
}: ApprovalPageLayoutProps) {
  return (
    <>
      <PageHeader title={title} description={description} actions={actions} />
      <div className="min-w-0 w-full space-y-4">{children}</div>
    </>
  );
}

"use client";

import { ApiProblem } from "@fmerp/shared/lib/api";
import { useCapabilities } from "@fmerp/shared/lib/queries";
import { MAILBOX_TABS } from "@fmerp/shared/lib/types";
import { cn } from "@fmerp/shared/lib/utils";
import { PageHeader } from "@fmerp/shared/ui/page-header";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DocumentTable } from "../components/document-table";
import { useMailbox } from "../queries";

/** 개인·부서·감사 문서함 (APV-080·081). 결재 대기·기안함은 기존 화면이다 */
export default function MailboxPage() {
  const { box } = useParams<{ box: string }>();
  const { data: capabilities } = useCapabilities(true);
  const tab = MAILBOX_TABS.find((t) => t.id === box);
  const query = useMailbox(box, Boolean(tab));
  const tabs = MAILBOX_TABS.filter((t) => t.id !== "audit" || capabilities?.["document.read_all"]);
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const forbidden = query.error instanceof ApiProblem && query.error.status === 403;

  return (
    <div className="space-y-4">
      <PageHeader title="문서함" />
      <nav
        aria-label="문서함 종류"
        className="flex gap-1 overflow-x-auto whitespace-nowrap border-b"
      >
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={`/mailbox/${t.id}`}
            aria-current={t.id === box ? "page" : undefined}
            className={cn(
              "relative inline-flex items-center px-1.5 py-1.5 text-sm font-medium whitespace-nowrap text-foreground/60 hover:text-foreground",
              "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground after:opacity-0",
              t.id === box && "text-foreground after:opacity-100",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab ? (
        <>
          <p className="text-sm text-muted-foreground">{tab.help}</p>
          {forbidden ? (
            <p role="alert" className="text-sm text-destructive">
              이 문서함을 볼 권한이 없습니다.
            </p>
          ) : (
            <DocumentTable
              rows={rows}
              loading={query.isLoading}
              hasMore={Boolean(query.hasNextPage)}
              loadingMore={query.isFetchingNextPage}
              onMore={() => query.fetchNextPage()}
            />
          )}
        </>
      ) : (
        <p role="alert" className="text-sm text-destructive">
          없는 문서함입니다.
        </p>
      )}
    </div>
  );
}

"use client";

import { useMine } from "@fmerp/shared/lib/queries";
import { formatDateTime, type MineItem } from "@fmerp/shared/lib/types";
import { Badge } from "@fmerp/shared/ui/badge";
import type { DataTableColumn } from "@fmerp/shared/ui/data-table";
import { LoadingState } from "@fmerp/shared/ui/loading-state";
import { PageHeader } from "@fmerp/shared/ui/page-header";
import { QueryErrorState } from "@fmerp/shared/ui/query-error-state";
import { Tabs, TabsList, TabsTrigger } from "@fmerp/shared/ui/tabs";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DocumentStatusBadge, DocumentTable } from "../components/document-table";

const TABS = [
  { value: "all", label: "전체", statuses: null },
  { value: "draft", label: "임시저장", statuses: ["DRAFT"] },
  { value: "progress", label: "진행 중", statuses: ["IN_PROGRESS", "ON_HOLD"] },
  { value: "returned", label: "반려·회수", statuses: ["REJECTED", "WITHDRAWN"] },
  { value: "done", label: "완료", statuses: ["COMPLETED", "CANCELED", "ARCHIVED"] },
] as const;

const COLUMNS: DataTableColumn<MineItem>[] = [
  {
    id: "title",
    header: "제목",
    className: "max-w-72",
    cell: (d) => (
      <>
        <Link
          href={d.status === "DRAFT" ? `/approval/draft/${d.id}` : `/approval/${d.id}`}
          className="break-words font-medium underline-offset-4 hover:underline"
        >
          {d.title}
        </Link>
        {d.urgent && (
          <Badge variant="destructive" className="ml-2">
            긴급
          </Badge>
        )}
        {d.supersedes && <span className="ml-2 text-xs text-muted-foreground">재기안</span>}
      </>
    ),
  },
  {
    id: "formCategory",
    header: "분류",
    cell: (d) => d.formCategory ?? "-",
  },
  {
    id: "status",
    header: "상태",
    cell: (d) => <DocumentStatusBadge status={d.status} />,
  },
  {
    id: "docNo",
    header: "문서번호",
    cell: (d) => d.docNo ?? "-",
    className: "tabular-nums",
  },
  {
    id: "updatedAt",
    header: "수정",
    cell: (d) => formatDateTime(d.updatedAt),
    className: "whitespace-nowrap",
  },
];

/** 기안함: 내가 기안한 문서 (APV-080 일부) */
export default function MyDocumentsPage() {
  const { data, isError, refetch } = useMine();
  const [tab, setTab] = useState<string>("all");
  const rows = useMemo(() => {
    const t = TABS.find((x) => x.value === tab);
    return (data ?? []).filter(
      (d) => !t?.statuses || (t.statuses as readonly string[]).includes(d.status),
    );
  }, [data, tab]);
  if (isError) return <QueryErrorState onRetry={() => void refetch()} />;
  if (!data) return <LoadingState />;

  return (
    <div className="space-y-4">
      <PageHeader title="기안함" />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line" className="flex-wrap">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <DocumentTable
        rows={rows}
        columns={COLUMNS}
        rowKey={(d) => d.id}
        caption="내가 기안한 문서 목록"
      />
    </div>
  );
}

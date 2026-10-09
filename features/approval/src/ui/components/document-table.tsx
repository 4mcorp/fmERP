"use client";

import { DOC_STATUS_LABEL, type DocumentListItem, formatDateTime } from "@fmerp/shared/lib/types";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { DataTable, type DataTableColumn, type DataTableFilter } from "@fmerp/shared/ui/data-table";
import Link from "next/link";

const SECURITY_LABEL: Record<string, string> = { confidential: "대외비", secret: "비밀" };

const when = (d: DocumentListItem) => d.completedAt ?? d.submittedAt ?? d.createdAt;

const COLUMNS: DataTableColumn<DocumentListItem>[] = [
  {
    id: "docNo",
    header: "문서번호",
    cell: (d) => d.docNo ?? "-",
    sortValue: (d) => d.docNo,
    className: "tabular-nums whitespace-nowrap",
  },
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
        {SECURITY_LABEL[d.securityLevel] && (
          <Badge variant="outline" className="ml-2">
            {SECURITY_LABEL[d.securityLevel]}
          </Badge>
        )}
      </>
    ),
  },
  {
    id: "drafter",
    header: "기안자",
    cell: (d) => d.drafterName,
    className: "whitespace-nowrap",
    hideBelow: "md",
  },
  {
    id: "status",
    header: "상태",
    cell: (d) => (
      <Badge variant={d.status === "COMPLETED" ? "secondary" : "outline"}>
        {DOC_STATUS_LABEL[d.status] ?? d.status}
      </Badge>
    ),
  },
  {
    id: "date",
    header: "일시",
    cell: (d) => formatDateTime(when(d)),
    sortValue: (d) => when(d),
    className: "whitespace-nowrap",
    hideBelow: "sm",
  },
];

const FILTERS: DataTableFilter<DocumentListItem>[] = [
  {
    id: "status",
    label: "상태 필터",
    allLabel: "전체 상태",
    options: Object.entries(DOC_STATUS_LABEL).map(([value, label]) => ({ value, label })),
    predicate: (d, v) => d.status === v,
  },
];

/** 문서함·검색 결과 표. 커서로 이어서 가져오는 "더 보기"를 함께 둔다 */
export function DocumentTable({
  rows,
  loading,
  hasMore,
  loadingMore,
  onMore,
  emptyText = "문서가 없습니다.",
}: {
  rows: DocumentListItem[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  emptyText?: string;
}) {
  return (
    <div>
      <DataTable
        rows={rows}
        columns={COLUMNS}
        rowKey={(d) => d.id}
        caption="문서 목록"
        isLoading={loading}
        empty={<div className="py-12 text-center text-sm text-muted-foreground">{emptyText}</div>}
        search={{
          placeholder: "제목·기안자·문서번호 검색",
          text: (d) => `${d.title} ${d.drafterName} ${d.docNo ?? ""}`,
        }}
        filters={FILTERS}
      />
      {hasMore && (
        <div className="flex justify-center pt-4">
          <Button variant="outline" onClick={onMore} disabled={loadingMore}>
            {loadingMore ? "불러오는 중…" : "더 보기"}
          </Button>
        </div>
      )}
    </div>
  );
}

"use client";

import { DOC_STATUS_LABEL, type DocumentListItem, formatDateTime } from "@fmerp/shared/lib/types";
import { cn } from "@fmerp/shared/lib/utils";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import {
  DataTable,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableProps,
} from "@fmerp/shared/ui/data-table";
import { EmptyState } from "@fmerp/shared/ui/empty-state";
import Link from "next/link";

const SECURITY_LABEL: Record<string, string> = { confidential: "대외비", secret: "비밀" };

/** `read`는 열람 여부. 목록 API가 주지 않으면 undefined(기본 스타일) */
type DocumentTableRow = DocumentListItem & { read?: boolean };

const when = (d: DocumentTableRow) => d.completedAt ?? d.submittedAt ?? d.createdAt;

/** 읽은 문서는 연하게, 안 읽은 문서는 진하게 (R8). 행 단위 class를 줄 수 없어 셀 내용마다 적용 */
const readTone = (d: DocumentTableRow) =>
  cn(
    d.read === false && "font-semibold text-foreground",
    d.read === true && "text-muted-foreground",
  );

/** 문서 상태 배지. 문서함·기안함·결재 대기·검색 표가 같은 모양을 쓴다 */
export function DocumentStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === "COMPLETED" ? "secondary" : "outline"}>
      {DOC_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

const COLUMNS: DataTableColumn<DocumentTableRow>[] = [
  {
    id: "docNo",
    header: "문서번호",
    cell: (d) => <span className={readTone(d)}>{d.docNo ?? "-"}</span>,
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
          className={cn(
            "break-words underline-offset-4 hover:underline",
            d.read === false ? "font-semibold text-foreground" : "font-medium",
            d.read === true && "text-muted-foreground",
          )}
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
    cell: (d) => <span className={readTone(d)}>{d.drafterName}</span>,
    className: "whitespace-nowrap",
    hideBelow: "md",
  },
  {
    id: "status",
    header: "상태",
    cell: (d) => <DocumentStatusBadge status={d.status} />,
  },
  {
    id: "date",
    header: "일시",
    cell: (d) => <span className={readTone(d)}>{formatDateTime(when(d))}</span>,
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

const SEARCH = {
  placeholder: "제목·기안자·문서번호 검색",
  text: (d: DocumentTableRow) => `${d.title} ${d.drafterName} ${d.docNo ?? ""}`,
};

/**
 * 문서 목록 표 (문서함·검색·기안함·결재 대기 공용). 머리줄·행 높이·상태 배지·빈 상태 모양은 같고,
 * 화면별로 `columns`만 고른다. `columns`를 생략하면 문서함 기본 열과 검색·상태 필터를 쓴다.
 * 빈 목록도 머리줄을 유지하고 본문 한 행에 안내를 둔다 (R15). 커서로 이어서 가져오는 "더 보기"를 함께 둔다.
 */
export function DocumentTable<T extends object = DocumentListItem>({
  rows,
  columns,
  rowKey,
  caption = "문서 목록",
  loading = false,
  hasMore = false,
  loadingMore = false,
  onMore,
  emptyText = "문서가 없습니다.",
}: {
  rows: T[];
  columns?: DataTableColumn<T>[];
  rowKey?: (row: T) => string;
  caption?: string;
  loading?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onMore?: () => void;
  emptyText?: string;
}) {
  const isDefault = columns === undefined;
  return (
    <div>
      <DataTable
        rows={rows}
        columns={columns ?? (COLUMNS as unknown as DataTableColumn<T>[])}
        rowKey={rowKey ?? ((row) => String((row as unknown as DocumentListItem).id))}
        caption={caption}
        isLoading={loading}
        empty={<EmptyState title={emptyText} />}
        search={isDefault ? (SEARCH as unknown as DataTableProps<T>["search"]) : undefined}
        filters={isDefault ? (FILTERS as unknown as DataTableFilter<T>[]) : []}
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

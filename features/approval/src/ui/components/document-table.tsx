"use client";

import { DOC_STATUS_LABEL, type DocumentListItem, formatDateTime } from "@fmerp/shared/lib/types";
import { cn } from "@fmerp/shared/lib/utils";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { DataTable, type DataTableColumn, type DataTableFilter } from "@fmerp/shared/ui/data-table";
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
    cell: (d) => (
      <Badge variant={d.status === "COMPLETED" ? "secondary" : "outline"}>
        {DOC_STATUS_LABEL[d.status] ?? d.status}
      </Badge>
    ),
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
        empty={<EmptyState title={emptyText} />}
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

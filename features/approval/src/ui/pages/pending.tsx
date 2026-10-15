"use client";

import { usePending } from "@fmerp/shared/lib/queries";
import {
  formatDateTime,
  type PendingItem,
  SECURITY_LABEL,
  STEP_TYPE_LABEL,
} from "@fmerp/shared/lib/types";
import { Badge } from "@fmerp/shared/ui/badge";
import type { DataTableColumn } from "@fmerp/shared/ui/data-table";
import { PageHeader } from "@fmerp/shared/ui/page-header";
import Link from "next/link";
import { DocumentStatusBadge, DocumentTable } from "../components/document-table";

const COLUMNS: DataTableColumn<PendingItem>[] = [
  {
    id: "title",
    header: "제목",
    className: "max-w-72",
    cell: (d) => (
      <>
        <Link
          href={`/approval/${d.documentId}`}
          className="break-words font-medium underline-offset-4 hover:underline"
        >
          {d.title}
        </Link>
        {d.urgent && (
          <Badge variant="destructive" className="ml-2">
            긴급
          </Badge>
        )}
        {d.securityLevel !== "normal" && (
          <Badge variant="outline" className="ml-2">
            {SECURITY_LABEL[d.securityLevel]}
          </Badge>
        )}
        {d.asDelegate && (
          <Badge variant="secondary" className="ml-2">
            대결
          </Badge>
        )}
      </>
    ),
  },
  {
    id: "drafter",
    header: "기안자",
    cell: (d) =>
      `${d.drafterSnapshot.name ?? "기안자"}${
        d.drafterSnapshot.departmentName ? ` · ${d.drafterSnapshot.departmentName}` : ""
      }`,
    className: "whitespace-nowrap",
    hideBelow: "md",
  },
  {
    id: "step",
    header: "단계",
    cell: (d) => `${STEP_TYPE_LABEL[d.stepType]} 차례`,
    className: "whitespace-nowrap",
  },
  {
    id: "status",
    header: "상태",
    cell: (d) => <DocumentStatusBadge status={d.status} />,
  },
  {
    id: "submittedAt",
    header: "상신",
    cell: (d) => (d.submittedAt ? formatDateTime(d.submittedAt) : "-"),
    className: "whitespace-nowrap",
    hideBelow: "sm",
  },
];

/**
 * 결재 대기: 지금 내가 처리할 차례인 문서 (APV-080 일부). 목록이 비어 있어도 표 머리줄을 유지한다 (R15).
 * 제목을 누르면 바로 문서로 들어간다
 */
export default function PendingPage() {
  const { data } = usePending();
  if (!data) return null;
  return (
    <div className="space-y-4">
      <PageHeader title="결재 대기" />
      <DocumentTable
        rows={data}
        columns={COLUMNS}
        rowKey={(d) => `${d.documentId}-${d.stepId}`}
        caption="결재 대기 문서 목록"
        emptyText="처리할 결재가 없습니다."
      />
    </div>
  );
}

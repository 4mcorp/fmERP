"use client";

import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent } from "@fmerp/shared/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@fmerp/shared/ui/table";
import Link from "next/link";
import { DOC_STATUS_LABEL, type DocumentListItem, formatDateTime } from "@/lib/types";

const SECURITY_LABEL: Record<string, string> = { confidential: "대외비", secret: "비밀" };

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
    <Card>
      <CardContent className="overflow-x-auto pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>제목</TableHead>
              <TableHead>기안자</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>문서번호</TableHead>
              <TableHead>일시</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="max-w-72">
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
                </TableCell>
                <TableCell className="whitespace-nowrap">{d.drafterName}</TableCell>
                <TableCell>
                  <Badge variant={d.status === "COMPLETED" ? "secondary" : "outline"}>
                    {DOC_STATUS_LABEL[d.status] ?? d.status}
                  </Badge>
                </TableCell>
                <TableCell className="tabular-nums">{d.docNo ?? "-"}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatDateTime(d.completedAt ?? d.submittedAt ?? d.createdAt)}
                </TableCell>
              </TableRow>
            ))}
            {loading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  불러오는 중…
                </TableCell>
              </TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  {emptyText}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {hasMore && (
          <div className="flex justify-center pt-4">
            <Button variant="outline" onClick={onMore} disabled={loadingMore}>
              {loadingMore ? "불러오는 중…" : "더 보기"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

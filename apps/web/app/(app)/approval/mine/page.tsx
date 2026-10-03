"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMine } from "@/lib/queries";
import { DOC_STATUS_LABEL, formatDateTime } from "@/lib/types";

const TABS = [
  { value: "all", label: "전체", statuses: null },
  { value: "draft", label: "임시저장", statuses: ["DRAFT"] },
  { value: "progress", label: "진행 중", statuses: ["IN_PROGRESS", "ON_HOLD"] },
  { value: "returned", label: "반려·회수", statuses: ["REJECTED", "WITHDRAWN"] },
  { value: "done", label: "완료", statuses: ["COMPLETED", "CANCELED", "ARCHIVED"] },
] as const;

/** 기안함: 내가 기안한 문서 (APV-080 일부) */
export default function MyDocumentsPage() {
  const { data } = useMine();
  const [tab, setTab] = useState<string>("all");
  const rows = useMemo(() => {
    const t = TABS.find((x) => x.value === tab);
    return (data ?? []).filter(
      (d) => !t?.statuses || (t.statuses as readonly string[]).includes(d.status),
    );
  }, [data, tab]);
  if (!data) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">기안함</h1>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Card>
        <CardContent className="overflow-x-auto pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>제목</TableHead>
                <TableHead>분류</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>문서번호</TableHead>
                <TableHead>수정</TableHead>
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
                    {d.supersedes && (
                      <span className="ml-2 text-xs text-muted-foreground">재기안</span>
                    )}
                  </TableCell>
                  <TableCell>{d.formCategory ?? "-"}</TableCell>
                  <TableCell>
                    <Badge variant={d.status === "COMPLETED" ? "secondary" : "outline"}>
                      {DOC_STATUS_LABEL[d.status] ?? d.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">{d.docNo ?? "-"}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(d.updatedAt)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    문서가 없습니다.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

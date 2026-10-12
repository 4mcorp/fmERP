"use client";

import { usePending } from "@fmerp/shared/lib/queries";
import { formatDateTime, SECURITY_LABEL, STEP_TYPE_LABEL } from "@fmerp/shared/lib/types";
import { Badge } from "@fmerp/shared/ui/badge";
import { Card, CardContent } from "@fmerp/shared/ui/card";
import { EmptyState } from "@fmerp/shared/ui/empty-state";
import { PageHeader } from "@fmerp/shared/ui/page-header";
import Link from "next/link";

/** 결재 대기: 지금 내가 처리할 차례인 문서 (APV-080 일부). 모바일에서도 목록에서 바로 문서로 들어간다 */
export default function PendingPage() {
  const { data } = usePending();
  if (!data) return null;
  return (
    <div className="space-y-4">
      <PageHeader title="결재 대기" />
      {data.length === 0 ? (
        <EmptyState title="처리할 결재가 없습니다." />
      ) : (
        <ul className="space-y-2">
          {data.map((d) => (
            <li key={`${d.documentId}-${d.stepId}`}>
              <Link href={`/approval/${d.documentId}`} className="block">
                <Card className="transition-colors hover:bg-muted/50">
                  <CardContent className="space-y-1 pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 break-words font-medium">{d.title}</span>
                      {d.urgent && <Badge variant="destructive">긴급</Badge>}
                      {d.securityLevel !== "normal" && (
                        <Badge variant="outline">{SECURITY_LABEL[d.securityLevel]}</Badge>
                      )}
                      {d.status === "ON_HOLD" && <Badge variant="outline">보류</Badge>}
                      {d.asDelegate && <Badge variant="secondary">대결</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {d.drafterSnapshot.name ?? "기안자"}
                      {d.drafterSnapshot.departmentName
                        ? ` · ${d.drafterSnapshot.departmentName}`
                        : ""}{" "}
                      · {STEP_TYPE_LABEL[d.stepType]} 차례
                      {d.submittedAt ? ` · ${formatDateTime(d.submittedAt)} 상신` : ""}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { api, errorMessage } from "@fmerp/shared/lib/api";
import { useForms } from "@fmerp/shared/lib/queries";
import type { FormSummary } from "@fmerp/shared/lib/types";
import { ActionBar } from "@fmerp/shared/ui/action-bar";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { DataTable, type DataTableColumn } from "@fmerp/shared/ui/data-table";
import { EmptyState } from "@fmerp/shared/ui/empty-state";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import { LoadingState } from "@fmerp/shared/ui/loading-state";
import { Modal } from "@fmerp/shared/ui/modal";
import { PageHeader } from "@fmerp/shared/ui/page-header";
import { QueryErrorState } from "@fmerp/shared/ui/query-error-state";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Upload } from "lucide-react";
import Link from "next/link";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { toast } from "sonner";

const COLUMNS: DataTableColumn<FormSummary>[] = [
  {
    id: "name",
    header: "양식",
    sortValue: (f) => f.name,
    cell: (f) => (
      <>
        <div className="font-medium">{f.name}</div>
        <div className="text-xs text-muted-foreground">{f.code}</div>
      </>
    ),
  },
  {
    id: "category",
    header: "분류",
    hideBelow: "md",
    sortValue: (f) => f.category,
    cell: (f) => f.category,
  },
  {
    id: "version",
    header: "버전",
    hideBelow: "sm",
    sortValue: (f) => f.version,
    cell: (f) => `v${f.version}`,
  },
  {
    id: "retention",
    header: "보존연한",
    hideBelow: "md",
    sortValue: (f) => f.retentionYears,
    cell: (f) => (f.retentionYears === 0 ? "영구" : `${f.retentionYears}년`),
  },
  {
    id: "status",
    header: "상태",
    sortValue: (f) => (f.active ? "사용" : "중지"),
    cell: (f) => (
      <Badge variant={f.active ? "secondary" : "outline"}>{f.active ? "사용" : "중지"}</Badge>
    ),
  },
];

/** 양식 관리: 목록, 복제, 사용 중지, JSON 내보내기·가져오기 (APV-006, ADM-004) */
export default function AdminFormsPage() {
  const queryClient = useQueryClient();
  const { data: forms, isError, refetch } = useForms(true);
  const [dup, setDup] = useState<FormSummary | null>(null);
  const [dupCode, setDupCode] = useState("");
  const [dupName, setDupName] = useState("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["forms"] });

  async function toggle(f: FormSummary) {
    try {
      await api(`/api/forms/${f.id}/${f.active ? "deactivate" : "activate"}`, { method: "POST" });
      await refresh();
      toast.success(
        f.active
          ? "양식 사용을 중지했습니다. 이미 작성된 문서는 그대로입니다"
          : "양식을 다시 사용합니다",
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function exportForm(f: FormSummary) {
    try {
      const data = await api<Record<string, unknown>>(`/api/forms/${f.id}/export`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${f.code}.form.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await api("/api/forms/import", { method: "POST", body: { data } });
      await refresh();
      toast.success("양식을 가져왔습니다");
    } catch (error) {
      toast.error(
        error instanceof SyntaxError ? "JSON 파일 형식이 올바르지 않습니다" : errorMessage(error),
      );
    }
  }

  async function duplicate(e: FormEvent) {
    e.preventDefault();
    if (!dup) return;
    try {
      await api(`/api/forms/${dup.id}/duplicate`, {
        method: "POST",
        body: { code: dupCode, name: dupName },
      });
      await refresh();
      toast.success("양식을 복제했습니다");
      setDup(null);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  if (isError) return <QueryErrorState onRetry={() => refetch()} />;
  if (!forms) return <LoadingState />;

  const columns: DataTableColumn<FormSummary>[] = [
    ...COLUMNS,
    {
      id: "actions",
      header: "작업",
      align: "right",
      cell: (f) => (
        <div className="flex flex-wrap items-center justify-end gap-1">
          <Button size="sm" variant="outline" asChild>
            <Link href={`/admin/forms/${f.id}`} aria-label={`${f.name} 편집`}>
              편집
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label={`${f.name} 복제`}
            onClick={() => {
              setDup(f);
              setDupCode(`${f.code}-COPY`);
              setDupName(`${f.name} 사본`);
            }}
          >
            복제
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`${f.name} JSON 내보내기`}
            onClick={() => exportForm(f)}
          >
            <Download aria-hidden />
          </Button>
          <Button
            size="sm"
            variant={f.active ? "destructive" : "outline"}
            aria-label={`${f.name} ${f.active ? "사용 중지" : "다시 사용"}`}
            onClick={() => toggle(f)}
          >
            {f.active ? "중지" : "사용"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="양식 관리"
        actions={
          <>
            <Button asChild>
              <Link href="/admin/forms/new">새 양식</Link>
            </Button>
            <Button variant="outline" asChild>
              <label htmlFor="form-import" className="cursor-pointer">
                <Upload aria-hidden />
                JSON 가져오기
              </label>
            </Button>
            <input
              id="form-import"
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={importFile}
            />
          </>
        }
      />
      <DataTable
        rows={forms}
        columns={columns}
        rowKey={(f) => String(f.id)}
        caption="양식 목록"
        search={{
          placeholder: "양식 이름·코드 검색",
          text: (f) => `${f.name} ${f.code} ${f.category}`,
        }}
        empty={
          <EmptyState
            icon={FileText}
            title="등록된 양식이 없습니다"
            description="새 양식을 만들거나 JSON 파일을 가져오세요"
          />
        }
      />

      <Modal
        open={dup !== null}
        onClose={() => setDup(null)}
        title="양식 복제"
        description={dup ? `${dup.name}의 최신 버전을 새 양식으로 복제합니다.` : undefined}
      >
        <form onSubmit={duplicate} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="dup-name">새 양식 이름</Label>
            <Input
              id="dup-name"
              value={dupName}
              onChange={(e) => setDupName(e.target.value)}
              required
              maxLength={100}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dup-code">새 양식 코드</Label>
            <Input
              id="dup-code"
              value={dupCode}
              onChange={(e) => setDupCode(e.target.value)}
              required
              pattern="[A-Za-z0-9_\-]{1,30}"
              title="영문·숫자·-·_ 30자 이하"
              autoComplete="off"
            />
          </div>
          <ActionBar>
            <Button type="button" variant="outline" onClick={() => setDup(null)}>
              취소
            </Button>
            <Button type="submit" variant="default">
              복제
            </Button>
          </ActionBar>
        </form>
      </Modal>
    </div>
  );
}

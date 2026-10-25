"use client";

import { api, errorMessage } from "@fmerp/shared/lib/api";
import { useBusinesses } from "@fmerp/shared/lib/queries";
import type { Business } from "@fmerp/shared/lib/types";
import { ActionBar } from "@fmerp/shared/ui/action-bar";
import { Badge } from "@fmerp/shared/ui/badge";
import { BusinessForm } from "@fmerp/shared/ui/business-form";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { ConfirmDialog } from "@fmerp/shared/ui/confirm-dialog";
import { DataTable, type DataTableColumn } from "@fmerp/shared/ui/data-table";
import { EmptyState } from "@fmerp/shared/ui/empty-state";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import { PageHeader } from "@fmerp/shared/ui/page-header";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@fmerp/shared/ui/sheet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { type ChangeEvent, useState } from "react";
import { toast } from "sonner";

const formatBizNo = (n: string) => `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}`;

/** 직인 이미지: 서명 URL로 저장소에 직접 올린 뒤 등록한다 (ORG-003, FILE-004) */
function SealField({ business }: { business: Business }) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const { data: image } = useQuery({
    queryKey: ["business-seal", business.id],
    queryFn: () => api<{ url: string }>(`/api/businesses/${business.id}/seal`),
    enabled: business.hasSeal,
  });

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const { uploadUrl, key } = await api<{ uploadUrl: string; key: string }>(
        `/api/businesses/${business.id}/seal/upload-url`,
        { method: "POST", body: { contentType: file.type } },
      );
      const put = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!put.ok) throw new Error("upload failed");
      await api(`/api/businesses/${business.id}/seal`, { method: "PUT", body: { key } });
      await queryClient.invalidateQueries({ queryKey: ["businesses"] });
      await queryClient.invalidateQueries({ queryKey: ["business-seal", business.id] });
      toast.success("직인 이미지를 등록했습니다");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={`seal-${business.id}`}>직인 이미지</Label>
      <div className="flex h-20 items-center justify-center rounded-md border bg-muted/30">
        {image ? (
          // biome-ignore lint/performance/noImgElement: 서명 URL(외부 저장소)이라 next/image 최적화 대상이 아니다
          <img src={image.url} alt={`${business.name} 직인`} className="max-h-16" />
        ) : (
          <span className="text-sm text-muted-foreground">등록된 이미지 없음</span>
        )}
      </div>
      <Input
        id={`seal-${business.id}`}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={onFile}
        disabled={uploading}
      />
      <p className="text-xs text-muted-foreground">PNG·JPEG·WebP, 2MB 이하</p>
    </div>
  );
}

function BusinessCard({ business }: { business: Business }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

  async function toggle() {
    try {
      await api(`/api/businesses/${business.id}/${business.active ? "deactivate" : "activate"}`, {
        method: "POST",
      });
      await queryClient.invalidateQueries({ queryKey: ["businesses"] });
      await queryClient.invalidateQueries({ queryKey: ["org-chart"] });
      toast.success(business.active ? "사업자를 비활성화했습니다" : "사업자를 다시 사용합니다");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {business.name}
          <Badge variant="secondary">{business.code}</Badge>
          {!business.active && <Badge variant="outline">비활성</Badge>}
        </CardTitle>
        <CardDescription>사업자등록번호 {formatBizNo(business.bizRegNo)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {editing ? (
          <BusinessForm business={business} onDone={() => setEditing(false)} />
        ) : (
          <>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {[
                ["대표자", business.ceoName],
                ["법인등록번호", business.corpRegNo],
                ["업태·종목", business.industry],
                ["대표 전화", business.phone],
                ["주소", business.address],
              ].map(([label, value]) => (
                <div key={label} className="flex gap-2">
                  <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
                  <dd>{value ?? "-"}</dd>
                </div>
              ))}
            </dl>
            <SealField business={business} />
            <ActionBar>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                수정
              </Button>
              <Button
                size="sm"
                variant={business.active ? "destructive" : "outline"}
                onClick={() => (business.active ? setConfirmingDeactivate(true) : toggle())}
              >
                {business.active ? "비활성화" : "다시 사용"}
              </Button>
            </ActionBar>
          </>
        )}
        <ConfirmDialog
          open={confirmingDeactivate}
          title={`${business.name} 사업자를 비활성화할까요?`}
          description="비활성화하면 새 발령·부서 배정에 쓸 수 없습니다. 언제든 다시 사용할 수 있습니다."
          confirmLabel="비활성화"
          onConfirm={() => toggle()}
          onClose={() => setConfirmingDeactivate(false)}
        />
      </CardContent>
    </Card>
  );
}

/** 사업자 관리: 등록·수정·비활성화 (PRD ORG-002~005, ADM-002) */
export default function BusinessesPage() {
  const { data: businesses } = useBusinesses();
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (!businesses) return null;
  const selected = businesses.find((b) => b.id === selectedId);

  const columns: DataTableColumn<Business>[] = [
    {
      id: "name",
      header: "사업자명",
      cell: (b) => <span className="font-medium">{b.name}</span>,
      sortValue: (b) => b.name,
    },
    { id: "code", header: "코드", cell: (b) => b.code, sortValue: (b) => b.code, hideBelow: "sm" },
    {
      id: "bizRegNo",
      header: "사업자등록번호",
      cell: (b) => <span className="tabular-nums">{formatBizNo(b.bizRegNo)}</span>,
      sortValue: (b) => b.bizRegNo,
      hideBelow: "md",
    },
    {
      id: "ceoName",
      header: "대표자",
      cell: (b) => b.ceoName ?? "-",
      sortValue: (b) => b.ceoName ?? "",
      hideBelow: "md",
    },
    {
      id: "active",
      header: "상태",
      cell: (b) => (
        <Badge variant={b.active ? "success" : "outline"}>{b.active ? "사용 중" : "비활성"}</Badge>
      ),
      sortValue: (b) => (b.active ? 0 : 1),
    },
    {
      id: "actions",
      header: "작업",
      align: "right",
      cell: (b) => (
        <Button
          size="sm"
          variant="outline"
          aria-label={`${b.name} 관리`}
          onClick={() => setSelectedId(b.id)}
        >
          관리
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="사업자 관리"
        description="사업자는 삭제하지 않고 비활성화합니다."
        breadcrumbs={[{ label: "관리" }, { label: "사업자 관리" }]}
        actions={
          <Button onClick={() => setAdding((v) => !v)} variant={adding ? "outline" : "default"}>
            {adding ? "닫기" : "사업자 등록"}
          </Button>
        }
      />
      {adding && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">새 사업자</CardTitle>
            <CardDescription>
              같은 회사 안에서 사업자등록번호·코드는 중복될 수 없습니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BusinessForm onDone={() => setAdding(false)} submitLabel="등록" />
          </CardContent>
        </Card>
      )}
      <DataTable
        rows={businesses}
        columns={columns}
        rowKey={(b) => b.id}
        caption="사업자 목록"
        search={{
          placeholder: "사업자명·코드 검색",
          text: (b) => `${b.name} ${b.code} ${b.bizRegNo}`,
        }}
        filters={[
          {
            id: "active",
            label: "상태",
            allLabel: "전체 상태",
            options: [
              { value: "active", label: "사용 중" },
              { value: "inactive", label: "비활성" },
            ],
            predicate: (b, v) => (v === "active") === b.active,
          },
        ]}
        empty={
          <EmptyState
            icon={Building2}
            title="등록된 사업자가 없습니다"
            description="먼저 사업자를 등록하세요."
          />
        }
      />
      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full p-4 sm:max-w-xl">
          <SheetTitle className="pr-8">{selected?.name ?? "사업자"}</SheetTitle>
          <SheetDescription className="sr-only">사업자 정보 확인·수정</SheetDescription>
          {selected && <BusinessCard business={selected} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

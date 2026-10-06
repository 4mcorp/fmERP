"use client";

import { api, errorMessage } from "@fmerp/shared/lib/api";
import { useBusinesses } from "@fmerp/shared/lib/queries";
import type { Business } from "@fmerp/shared/lib/types";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useState } from "react";
import { toast } from "sonner";
import { BusinessForm } from "@/components/org/business-form";

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

  async function toggle() {
    if (business.active && !window.confirm(`${business.name} 사업자를 비활성화할까요?`)) return;
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
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                수정
              </Button>
              <Button
                size="sm"
                variant={business.active ? "destructive" : "outline"}
                onClick={toggle}
              >
                {business.active ? "비활성화" : "다시 사용"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** 사업자 관리: 등록·수정·비활성화 (PRD ORG-002~005, ADM-002) */
export default function BusinessesPage() {
  const { data: businesses } = useBusinesses();
  const [adding, setAdding] = useState(false);
  if (!businesses) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">사업자 관리</h1>
        <Button onClick={() => setAdding((v) => !v)} variant={adding ? "outline" : "default"}>
          {adding ? "닫기" : "사업자 등록"}
        </Button>
      </div>
      {adding && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">새 사업자</CardTitle>
            <CardDescription>
              사업자는 삭제하지 않고 비활성화합니다. 같은 회사 안에서 사업자등록번호·코드는 중복될
              수 없습니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BusinessForm onDone={() => setAdding(false)} submitLabel="등록" />
          </CardContent>
        </Card>
      )}
      {businesses.length === 0 && !adding && (
        <p className="text-muted-foreground">등록된 사업자가 없습니다. 먼저 사업자를 등록하세요.</p>
      )}
      {businesses.map((b) => (
        <BusinessCard key={b.id} business={b} />
      ))}
    </div>
  );
}

"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import type { Me } from "@/lib/types";

type ImageKind = "signature" | "stamp";
const KIND_LABEL: Record<ImageKind, string> = { signature: "서명", stamp: "도장" };

/** 서명·도장 이미지: 서명 URL로 저장소에 직접 올린 뒤 등록한다 (AUTH-016, FILE-004) */
function ImageField({ kind, registered }: { kind: ImageKind; registered: boolean }) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const { data: image } = useQuery({
    queryKey: ["me-image", kind],
    queryFn: () => api<{ url: string }>(`/api/me/images/${kind}`),
    enabled: registered,
  });

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const { uploadUrl, key } = await api<{ uploadUrl: string; key: string }>(
        `/api/me/images/${kind}/upload-url`,
        { method: "POST", body: { contentType: file.type } },
      );
      const put = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!put.ok) throw new Error("upload failed");
      await api(`/api/me/images/${kind}`, { method: "PUT", body: { key } });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["me-image", kind] });
      toast.success(`${KIND_LABEL[kind]} 이미지를 등록했습니다`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  const inputId = `${kind}-file`;
  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{KIND_LABEL[kind]}</Label>
      <div className="flex h-24 items-center justify-center rounded-md border bg-muted/30">
        {image ? (
          // biome-ignore lint/performance/noImgElement: 서명 URL(외부 저장소)이라 next/image 최적화 대상이 아니다
          <img src={image.url} alt={`등록된 ${KIND_LABEL[kind]}`} className="max-h-20" />
        ) : (
          <span className="text-sm text-muted-foreground">등록된 이미지 없음</span>
        )}
      </div>
      <Input
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={onFile}
        disabled={uploading}
      />
      <p className="text-xs text-muted-foreground">PNG·JPEG·WebP, 2MB 이하</p>
    </div>
  );
}

export function ProfileSection({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(me.name);
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/me", { method: "PATCH", body: { name } });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("저장했습니다");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>프로필</CardTitle>
        <CardDescription>{me.email}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={save} className="flex items-end gap-2">
          <div className="flex-1 space-y-2">
            <Label htmlFor="profile-name">이름</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              required
            />
          </div>
          <Button type="submit" disabled={saving}>
            저장
          </Button>
        </form>
        <div className="grid gap-4 sm:grid-cols-2">
          <ImageField kind="signature" registered={me.hasSignature} />
          <ImageField kind="stamp" registered={me.hasStamp} />
        </div>
      </CardContent>
    </Card>
  );
}

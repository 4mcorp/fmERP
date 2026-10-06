"use client";

import { ApiProblem, api, errorMessage } from "@fmerp/shared/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@fmerp/shared/ui/alert";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@fmerp/shared/ui/select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { useCurrentAccount, useMe } from "@/lib/queries";
import type { AccountSettings } from "@/lib/types";

interface Exceeding {
  id: string;
  name: string;
  depth: number;
}

const splitList = (value: string) =>
  value
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);

/** 계정 설정: 기본 정보·허용 도메인·부서 최대 뎁스·세션·재인증·첨부 정책 (PRD ORG-001, ORG-012, ADM-001) */
export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const { data: account } = useCurrentAccount(Boolean(me?.activeAccountId));
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<AccountSettings>("/api/account/settings"),
  });
  const [form, setForm] = useState({
    name: "",
    domains: "",
    depth: "1",
    idle: "",
    absolute: "",
    pinRequired: true,
    allowAdminExport: false,
    attachMb: "",
    attachExt: "",
  });
  const [exceeding, setExceeding] = useState<Exceeding[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    const p = data.securityPolicy;
    setForm({
      name: data.name,
      domains: data.allowedDomains.join(", "),
      depth: String(data.maxDeptDepth),
      idle: p.idleTimeoutMinutes ? String(p.idleTimeoutMinutes) : "",
      absolute: p.absoluteTimeoutHours ? String(p.absoluteTimeoutHours) : "",
      pinRequired: p.pinRequired ?? true,
      allowAdminExport: p.allowAdminExport ?? false,
      attachMb: p.attachmentMaxMb ? String(p.attachmentMaxMb) : "",
      attachExt: (p.attachmentExtensions ?? []).join(", "),
    });
  }, [data]);

  const set = (key: keyof typeof form) => (value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setExceeding(null);
    try {
      await api("/api/account/settings", {
        method: "PATCH",
        body: {
          name: form.name,
          allowedDomains: splitList(form.domains),
          maxDeptDepth: Number(form.depth),
          securityPolicy: {
            ...(form.idle ? { idleTimeoutMinutes: Number(form.idle) } : {}),
            ...(form.absolute ? { absoluteTimeoutHours: Number(form.absolute) } : {}),
            pinRequired: form.pinRequired,
            // 계정 관리자에게 내보내기를 허용하는 설정은 소유자만 바꿀 수 있다 (관리자가 보내면 서버가 거부한다)
            ...(account?.myRole === "owner" ? { allowAdminExport: form.allowAdminExport } : {}),
            ...(form.attachMb ? { attachmentMaxMb: Number(form.attachMb) } : {}),
            attachmentExtensions: splitList(form.attachExt),
          },
        },
      });
      await queryClient.invalidateQueries();
      toast.success("계정 설정을 저장했습니다");
    } catch (error) {
      if (error instanceof ApiProblem && error.code === "depth_exceeded") {
        setExceeding((error.extensions?.departments as Exceeding[] | undefined) ?? []);
      }
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  if (!data) return null;

  return (
    <form onSubmit={save} className="space-y-4">
      <h1 className="text-2xl font-semibold">계정 설정</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">기본 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="s-name">회사 이름</Label>
            <Input
              id="s-name"
              value={form.name}
              onChange={(e) => set("name")(e.target.value)}
              minLength={2}
              maxLength={100}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-domains">허용 도메인 (쉼표로 구분)</Label>
            <Input
              id="s-domains"
              value={form.domains}
              onChange={(e) => set("domains")(e.target.value)}
              placeholder="example.com"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">부서 최대 뎁스</CardTitle>
          <CardDescription>
            1~5단계. 높이는 것은 언제든 가능하고, 낮추려면 새 값을 넘는 부서가 없어야 합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-w-40 space-y-2">
            <Label htmlFor="s-depth">최대 뎁스</Label>
            {/* Radix Select는 값이 바뀔 때 숨은 select가 빈 값("")을 보낼 수 있어, 빈 값은 무시한다 (그대로 저장하면 최대 뎁스가 0이 된다) */}
            <Select value={form.depth} onValueChange={(v) => v && set("depth")(v)}>
              <SelectTrigger id="s-depth" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}단계
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {exceeding && (
            <Alert variant="destructive">
              <AlertTitle>{form.depth}단계를 넘는 부서가 있어 줄일 수 없습니다</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {exceeding.map((d) => (
                    <li key={d.id}>
                      {d.name} ({d.depth}단계)
                    </li>
                  ))}
                </ul>
                <p className="mt-1">이 부서들을 위 단계로 옮기거나 폐지한 뒤 다시 시도하세요.</p>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">보안·첨부 정책</CardTitle>
          <CardDescription>비워 두면 기본값(유휴 120분, 절대 12시간)을 씁니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="s-idle">유휴 만료 (분, 5~1440)</Label>
            <Input
              id="s-idle"
              type="number"
              min={5}
              max={1440}
              value={form.idle}
              onChange={(e) => set("idle")(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-abs">절대 만료 (시간, 1~72)</Label>
            <Input
              id="s-abs"
              type="number"
              min={1}
              max={72}
              value={form.absolute}
              onChange={(e) => set("absolute")(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <input
              id="s-pin"
              type="checkbox"
              checked={form.pinRequired}
              onChange={(e) => set("pinRequired")(e.target.checked)}
              className="size-4"
            />
            <Label htmlFor="s-pin">
              결재를 처리하기 전에 PIN 재인증을 요구한다 (백업·내보내기는 이 설정과 상관없이 항상
              요구)
            </Label>
          </div>
          {account?.myRole === "owner" && (
            <div className="space-y-1 sm:col-span-2">
              <div className="flex items-center gap-2">
                <input
                  id="s-export"
                  type="checkbox"
                  checked={form.allowAdminExport}
                  onChange={(e) => set("allowAdminExport")(e.target.checked)}
                  className="size-4"
                />
                <Label htmlFor="s-export">계정 관리자에게 계정 전체 내보내기를 허용한다</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                내보내기 파일에는 모든 완료 문서의 본문이 들어 있습니다. 계정 관리자는 원래 문서
                본문을 볼 수 없으므로 꼭 필요할 때만 허용하세요. 요청과 내려받기는 모두 감사 로그에
                남습니다.
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="s-mb">첨부 최대 크기 (MB, 1~100)</Label>
            <Input
              id="s-mb"
              type="number"
              min={1}
              max={100}
              value={form.attachMb}
              onChange={(e) => set("attachMb")(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-ext">허용 확장자 (쉼표로 구분)</Label>
            <Input
              id="s-ext"
              value={form.attachExt}
              onChange={(e) => set("attachExt")(e.target.value)}
              placeholder="pdf, png, jpg"
            />
          </div>
        </CardContent>
      </Card>

      <Button type="submit" disabled={saving}>
        {saving ? "저장 중…" : "저장"}
      </Button>
    </form>
  );
}

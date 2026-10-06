"use client";

import { api, errorMessage } from "@fmerp/shared/lib/api";
import type { Business } from "@fmerp/shared/lib/types";
import { Button } from "@fmerp/shared/ui/button";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

const FIELDS = [
  { key: "name", label: "상호", required: true },
  {
    key: "bizRegNo",
    label: "사업자등록번호 (10자리)",
    required: true,
    placeholder: "000-00-00000",
  },
  { key: "code", label: "사업자 코드 (문서번호용, 영문 대문자·숫자)", required: true },
  { key: "corpRegNo", label: "법인등록번호" },
  { key: "ceoName", label: "대표자" },
  { key: "industry", label: "업태·종목" },
  { key: "address", label: "주소" },
  { key: "phone", label: "대표 전화" },
] as const;

type Values = Record<(typeof FIELDS)[number]["key"], string>;

const empty: Values = {
  name: "",
  bizRegNo: "",
  code: "",
  corpRegNo: "",
  ceoName: "",
  industry: "",
  address: "",
  phone: "",
};

/** 사업자 등록·수정 폼 (PRD ORG-002·003). 사업자등록번호 체크섬은 서버가 검증하고 메시지를 돌려준다 */
export function BusinessForm({
  business,
  onDone,
  submitLabel = "저장",
}: {
  business?: Business;
  onDone?: () => void;
  submitLabel?: string;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Values>(
    business
      ? {
          name: business.name,
          bizRegNo: business.bizRegNo,
          code: business.code,
          corpRegNo: business.corpRegNo ?? "",
          ceoName: business.ceoName ?? "",
          industry: business.industry ?? "",
          address: business.address ?? "",
          phone: business.phone ?? "",
        }
      : empty,
  );
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k, v.trim() === "" ? null : v.trim()]),
      );
      await api(business ? `/api/businesses/${business.id}` : "/api/businesses", {
        method: business ? "PATCH" : "POST",
        body: { ...body, name: values.name, bizRegNo: values.bizRegNo, code: values.code },
      });
      await queryClient.invalidateQueries({ queryKey: ["businesses"] });
      await queryClient.invalidateQueries({ queryKey: ["org-chart"] });
      toast.success(business ? "사업자 정보를 수정했습니다" : "사업자를 등록했습니다");
      if (!business) setValues(empty);
      onDone?.();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-2">
            <Label htmlFor={`biz-${f.key}`}>{f.label}</Label>
            <Input
              id={`biz-${f.key}`}
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              required={"required" in f && f.required}
              placeholder={"placeholder" in f ? f.placeholder : undefined}
              maxLength={200}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "저장 중…" : submitLabel}
        </Button>
        {onDone && business && (
          <Button type="button" variant="outline" onClick={onDone}>
            취소
          </Button>
        )}
      </div>
    </form>
  );
}

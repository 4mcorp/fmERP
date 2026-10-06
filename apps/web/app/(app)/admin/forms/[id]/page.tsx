"use client";

import { type FormField, type FormSchema, validateFormSchema } from "@fmerp/core";
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
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormFields, type Values } from "@/components/approval/form-fields";
import {
  itemsToRows,
  LineEditor,
  type LineRow,
  rowsToItems,
} from "@/components/approval/line-editor";
import { useBusinesses, useDepartments, useFormDetail, useMembers } from "@/lib/queries";
import type { FormDefinition, SecurityLevel } from "@/lib/types";
import { SECURITY_LABEL } from "@/lib/types";

const FIELD_TYPE_LABEL: Record<FormField["type"], string> = {
  text: "텍스트",
  textarea: "여러 줄 텍스트",
  number: "숫자",
  money: "금액(원)",
  date: "날짜",
  daterange: "기간",
  select: "단일 선택",
  multiselect: "다중 선택",
  user: "사용자 선택",
  dept: "부서 선택",
  table: "표",
  richtext: "리치 텍스트",
  attachment: "첨부",
};

function blankField(type: FormField["type"], n: number): FormField {
  const base = { key: `field${n}`, label: `항목 ${n}`, type } as const;
  switch (type) {
    case "select":
    case "multiselect":
      return { ...base, type, options: [{ value: "a", label: "선택지 1" }] };
    case "table":
      return { ...base, type, columns: [{ key: "name", label: "항목", type: "text" }] };
    default:
      return { ...base, type } as FormField;
  }
}

const numOrUndef = (v: string) => (v === "" ? undefined : Number(v));

function FieldEditor({
  field,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  field: FormField;
  index: number;
  total: number;
  onChange: (f: FormField) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const id = `fe-${index}`;
  const set = (patch: Record<string, unknown>) => onChange({ ...field, ...patch } as FormField);
  return (
    <li className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {index + 1}. {FIELD_TYPE_LABEL[field.type]}
        </span>
        <div className="ml-auto flex gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`${index + 1}번째 필드 위로`}
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`${index + 1}번째 필드 아래로`}
            disabled={index === total - 1}
            onClick={() => onMove(index + 1)}
          >
            <ArrowDown aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`${index + 1}번째 필드 삭제`}
            onClick={onRemove}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`${id}-label`}>라벨</Label>
          <Input
            id={`${id}-label`}
            value={field.label}
            onChange={(e) => set({ label: e.target.value })}
            maxLength={100}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-key`}>키 (영문)</Label>
          <Input
            id={`${id}-key`}
            value={field.key}
            onChange={(e) => set({ key: e.target.value })}
            maxLength={40}
            autoComplete="off"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-help`}>도움말</Label>
          <Input
            id={`${id}-help`}
            value={field.help ?? ""}
            onChange={(e) => set({ help: e.target.value || undefined })}
            maxLength={300}
          />
        </div>
      </div>
      {field.type !== "attachment" && (
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={field.required ?? false}
            onChange={(e) => set({ required: e.target.checked })}
          />
          필수 항목
        </label>
      )}
      {(field.type === "text" || field.type === "textarea") && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor={`${id}-minl`}>최소 길이</Label>
            <Input
              id={`${id}-minl`}
              type="number"
              min={0}
              value={field.minLength ?? ""}
              onChange={(e) => set({ minLength: numOrUndef(e.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-maxl`}>최대 길이</Label>
            <Input
              id={`${id}-maxl`}
              type="number"
              min={0}
              value={field.maxLength ?? ""}
              onChange={(e) => set({ maxLength: numOrUndef(e.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-pattern`}>정규식 검증</Label>
            <Input
              id={`${id}-pattern`}
              value={field.pattern ?? ""}
              onChange={(e) => set({ pattern: e.target.value || undefined })}
              placeholder="예: ^[0-9]{3}-[0-9]{4}$"
              autoComplete="off"
            />
          </div>
        </div>
      )}
      {(field.type === "number" || field.type === "money") && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor={`${id}-min`}>최솟값</Label>
            <Input
              id={`${id}-min`}
              type="number"
              value={field.min ?? ""}
              onChange={(e) => set({ min: numOrUndef(e.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-max`}>최댓값</Label>
            <Input
              id={`${id}-max`}
              type="number"
              value={field.max ?? ""}
              onChange={(e) => set({ max: numOrUndef(e.target.value) })}
            />
          </div>
          {field.type === "number" && (
            <label className="flex items-center gap-1.5 self-end pb-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={field.integer ?? false}
                onChange={(e) => set({ integer: e.target.checked })}
              />
              정수만
            </label>
          )}
        </div>
      )}
      {(field.type === "user" || field.type === "dept") && (
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={field.multiple ?? false}
            onChange={(e) => set({ multiple: e.target.checked })}
          />
          여러 명(개) 선택
        </label>
      )}
      {field.type === "attachment" && (
        <div className="max-w-40 space-y-1">
          <Label htmlFor={`${id}-files`}>최대 개수</Label>
          <Input
            id={`${id}-files`}
            type="number"
            min={0}
            value={field.maxFiles ?? ""}
            onChange={(e) => set({ maxFiles: numOrUndef(e.target.value) })}
          />
        </div>
      )}
      {(field.type === "select" || field.type === "multiselect") && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">선택지</legend>
          {field.options.map((o, oi) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 선택지는 순서가 곧 식별자다
            <div key={oi} className="flex flex-wrap gap-2">
              <Input
                aria-label={`선택지 ${oi + 1} 값`}
                className="w-32"
                value={o.value}
                onChange={(e) =>
                  set({
                    options: field.options.map((x, xi) =>
                      xi === oi ? { ...x, value: e.target.value } : x,
                    ),
                  })
                }
              />
              <Input
                aria-label={`선택지 ${oi + 1} 라벨`}
                className="min-w-40 flex-1"
                value={o.label}
                onChange={(e) =>
                  set({
                    options: field.options.map((x, xi) =>
                      xi === oi ? { ...x, label: e.target.value } : x,
                    ),
                  })
                }
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`선택지 ${oi + 1} 삭제`}
                onClick={() => set({ options: field.options.filter((_, xi) => xi !== oi) })}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              set({
                options: [
                  ...field.options,
                  {
                    value: `v${field.options.length + 1}`,
                    label: `선택지 ${field.options.length + 1}`,
                  },
                ],
              })
            }
          >
            <Plus aria-hidden />
            선택지 추가
          </Button>
        </fieldset>
      )}
      {field.type === "table" && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">열</legend>
          {field.columns.map((c, ci) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 열은 순서가 곧 식별자다
            <div key={ci} className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={`열 ${ci + 1} 키`}
                className="w-28"
                value={c.key}
                onChange={(e) =>
                  set({
                    columns: field.columns.map((x, xi) =>
                      xi === ci ? { ...x, key: e.target.value } : x,
                    ),
                  })
                }
              />
              <Input
                aria-label={`열 ${ci + 1} 라벨`}
                className="min-w-32 flex-1"
                value={c.label}
                onChange={(e) =>
                  set({
                    columns: field.columns.map((x, xi) =>
                      xi === ci ? { ...x, label: e.target.value } : x,
                    ),
                  })
                }
              />
              <Select
                value={c.type}
                onValueChange={(v) =>
                  set({
                    columns: field.columns.map((x, xi) =>
                      xi === ci
                        ? { ...x, type: v, sum: v === "number" || v === "money" ? x.sum : false }
                        : x,
                    ),
                  })
                }
              >
                <SelectTrigger aria-label={`열 ${ci + 1} 유형`} className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">텍스트</SelectItem>
                  <SelectItem value="number">숫자</SelectItem>
                  <SelectItem value="money">금액</SelectItem>
                  <SelectItem value="date">날짜</SelectItem>
                </SelectContent>
              </Select>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={c.required ?? false}
                  onChange={(e) =>
                    set({
                      columns: field.columns.map((x, xi) =>
                        xi === ci ? { ...x, required: e.target.checked } : x,
                      ),
                    })
                  }
                />
                필수
              </label>
              {(c.type === "number" || c.type === "money") && (
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={c.sum ?? false}
                    onChange={(e) =>
                      set({
                        columns: field.columns.map((x, xi) =>
                          xi === ci ? { ...x, sum: e.target.checked } : x,
                        ),
                      })
                    }
                  />
                  합계
                </label>
              )}
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`열 ${ci + 1} 삭제`}
                onClick={() => set({ columns: field.columns.filter((_, xi) => xi !== ci) })}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              set({
                columns: [
                  ...field.columns,
                  {
                    key: `col${field.columns.length + 1}`,
                    label: `열 ${field.columns.length + 1}`,
                    type: "text",
                  },
                ],
              })
            }
          >
            <Plus aria-hidden />열 추가
          </Button>
          <div className="grid max-w-sm gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`${id}-minr`}>최소 행</Label>
              <Input
                id={`${id}-minr`}
                type="number"
                min={0}
                value={field.minRows ?? ""}
                onChange={(e) => set({ minRows: numOrUndef(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-maxr`}>최대 행</Label>
              <Input
                id={`${id}-maxr`}
                type="number"
                min={0}
                value={field.maxRows ?? ""}
                onChange={(e) => set({ maxRows: numOrUndef(e.target.value) })}
              />
            </div>
          </div>
        </fieldset>
      )}
    </li>
  );
}

const DEFAULT_DEF: FormDefinition = {
  schema: { fields: [{ key: "body", label: "내용", type: "richtext", required: true }] },
  defaultLine: [{ type: "approve", seq: 1, target: { kind: "drafter_head", levels: 1 } }],
  numbering: { rule: "{사업자코드}-{양식코드}-{YYYY}-{SEQ:4}", cycle: "year", at: "complete" },
  retentionYears: 3,
  securityDefault: "normal",
  allowLineEdit: true,
  policy: { disagree: "reject", rejectTo: "drafter", auditCanReject: true },
};

/** 양식 빌더: 필드 나열 + 표 + 리치 텍스트 (D8), 속성·결재선·문서번호·보존연한, 미리보기. 저장하면 새 버전이 된다 (APV-001·004~007, ADM-004) */
export default function FormBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: detail } = useFormDetail(isNew ? undefined : id);
  const { data: members } = useMembers();
  const { data: departments } = useDepartments();
  const { data: businesses } = useBusinesses();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("일반");
  const [def, setDef] = useState<FormDefinition>(DEFAULT_DEF);
  const [rows, setRows] = useState<LineRow[]>(() => itemsToRows(DEFAULT_DEF.defaultLine));
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [addType, setAddType] = useState<FormField["type"]>("text");
  const [loaded, setLoaded] = useState(isNew);

  useEffect(() => {
    if (!detail || loaded) return;
    setCode(detail.code);
    setName(detail.name);
    setCategory(detail.category);
    setDef(detail.definition);
    setRows(itemsToRows(detail.definition.defaultLine));
    setLoaded(true);
  }, [detail, loaded]);

  const ctx = useMemo(
    () => ({
      members: members ?? [],
      departments: departments ?? [],
      businesses: businesses ?? [],
    }),
    [members, departments, businesses],
  );
  const fields = def.schema.fields;
  const setFields = (next: FormField[]) =>
    setDef((d) => ({ ...d, schema: { fields: next } as FormSchema }));
  const previewForm = useForm<Values>({ defaultValues: {} });
  const schemaCheck = validateFormSchema(def.schema);

  async function save(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    setSaving(true);
    try {
      const version = { ...def, defaultLine: rowsToItems(rows) };
      if (isNew) {
        const created = await api<{ formId: string }>("/api/forms", {
          method: "POST",
          body: { code, name, category, version },
        });
        toast.success("양식을 만들었습니다");
        await queryClient.invalidateQueries({ queryKey: ["forms"] });
        router.replace(`/admin/forms/${created.formId}`);
      } else {
        const result = await api<{ version: number }>(`/api/forms/${id}/versions`, {
          method: "POST",
          body: { version, name, category },
        });
        toast.success(
          `새 버전(v${result.version})으로 저장했습니다. 이미 작성된 문서는 이전 버전을 따릅니다`,
        );
        await queryClient.invalidateQueries({ queryKey: ["forms"] });
        await queryClient.invalidateQueries({ queryKey: ["form", id] });
      }
    } catch (error) {
      const list = error instanceof ApiProblem ? error.extensions?.errors : undefined;
      setErrors(Array.isArray(list) ? list.map(String) : [errorMessage(error)]);
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;
  const moveField = (from: number, to: number) => {
    const next = [...fields];
    const [item] = next.splice(from, 1);
    if (item) next.splice(to, 0, item);
    setFields(next);
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <h1 className="text-2xl font-semibold">
        {isNew ? "새 양식" : `${name} 편집${detail ? ` (현재 v${detail.version})` : ""}`}
      </h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">기본 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="form-name">양식 이름</Label>
            <Input
              id="form-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="form-code">양식 코드 (문서번호용)</Label>
            <Input
              id="form-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              disabled={!isNew}
              pattern="[A-Za-z0-9_\-]{1,30}"
              title="영문·숫자·-·_ 30자 이하"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="form-category">분류</Label>
            <Input
              id="form-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
              maxLength={50}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">필드</CardTitle>
          <CardDescription>
            입력 항목을 위에서 아래로 나열합니다. 표는 행 추가와 열 합계를, 리치 텍스트는 서식 있는
            본문을 지원합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="space-y-2">
            {fields.map((f, i) => (
              <FieldEditor
                // biome-ignore lint/suspicious/noArrayIndexKey: 키를 편집할 수 있어 순서로 식별한다
                key={i}
                field={f}
                index={i}
                total={fields.length}
                onChange={(next) => setFields(fields.map((x, xi) => (xi === i ? next : x)))}
                onMove={(to) => moveField(i, to)}
                onRemove={() => setFields(fields.filter((_, xi) => xi !== i))}
              />
            ))}
          </ol>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="add-type">필드 유형</Label>
              <Select value={addType} onValueChange={(v) => setAddType(v as FormField["type"])}>
                <SelectTrigger id="add-type" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(FIELD_TYPE_LABEL) as FormField["type"][]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {FIELD_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFields([...fields, blankField(addType, fields.length + 1)])}
            >
              <Plus aria-hidden />
              필드 추가
            </Button>
          </div>
          {!schemaCheck.ok && (
            <Alert variant="destructive">
              <AlertTitle>필드 정의를 확인하세요</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {schemaCheck.errors.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">속성</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="form-retention">보존연한</Label>
            <Select
              value={String(def.retentionYears)}
              onValueChange={(v) =>
                setDef({ ...def, retentionYears: Number(v) as FormDefinition["retentionYears"] })
              }
            >
              <SelectTrigger id="form-retention" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 3, 5, 10].map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}년
                  </SelectItem>
                ))}
                <SelectItem value="0">영구</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="form-security">보안 등급 기본값</Label>
            <Select
              value={def.securityDefault}
              onValueChange={(v) => setDef({ ...def, securityDefault: v as SecurityLevel })}
            >
              <SelectTrigger id="form-security" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SECURITY_LABEL) as SecurityLevel[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {SECURITY_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={def.allowLineEdit}
              onChange={(e) => setDef({ ...def, allowLineEdit: e.target.checked })}
            />
            기안자·결재자가 결재선을 바꿀 수 있다
          </label>
          <div className="space-y-2">
            <Label htmlFor="form-disagree">합의 부동의</Label>
            <Select
              value={def.policy.disagree}
              onValueChange={(v) =>
                setDef({ ...def, policy: { ...def.policy, disagree: v as "reject" | "comment" } })
              }
            >
              <SelectTrigger id="form-disagree" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reject">반려로 처리</SelectItem>
                <SelectItem value="comment">의견만 남기고 진행</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="form-rejectto">반려 대상</Label>
            <Select
              value={def.policy.rejectTo}
              onValueChange={(v) =>
                setDef({ ...def, policy: { ...def.policy, rejectTo: v as "drafter" | "previous" } })
              }
            >
              <SelectTrigger id="form-rejectto" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="drafter">기안자에게</SelectItem>
                <SelectItem value="previous">직전 결재 단계로</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={def.policy.auditCanReject}
              onChange={(e) =>
                setDef({ ...def, policy: { ...def.policy, auditCanReject: e.target.checked } })
              }
            />
            감사 단계에서 반려할 수 있다
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">문서번호</CardTitle>
          <CardDescription>
            토큰: {"{사업자코드} {부서코드} {양식코드} {YYYY} {YY} {MM} {SEQ:4}"} — {"{SEQ:n}"}은
            정확히 하나 필요합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={def.numbering !== null}
              onChange={(e) =>
                setDef({ ...def, numbering: e.target.checked ? DEFAULT_DEF.numbering : null })
              }
            />
            문서번호를 자동 부여한다
          </label>
          {def.numbering && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="num-rule">규칙</Label>
                <Input
                  id="num-rule"
                  value={def.numbering.rule}
                  onChange={(e) =>
                    setDef({
                      ...def,
                      numbering: {
                        ...(def.numbering as NonNullable<FormDefinition["numbering"]>),
                        rule: e.target.value,
                      },
                    })
                  }
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="num-cycle">순번 초기화</Label>
                <Select
                  value={def.numbering.cycle}
                  onValueChange={(v) =>
                    setDef({
                      ...def,
                      numbering: {
                        ...(def.numbering as NonNullable<FormDefinition["numbering"]>),
                        cycle: v as "year" | "month" | "none",
                      },
                    })
                  }
                >
                  <SelectTrigger id="num-cycle" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="year">해마다</SelectItem>
                    <SelectItem value="month">달마다</SelectItem>
                    <SelectItem value="none">안 함</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="num-at">부여 시점</Label>
                <Select
                  value={def.numbering.at}
                  onValueChange={(v) =>
                    setDef({
                      ...def,
                      numbering: {
                        ...(def.numbering as NonNullable<FormDefinition["numbering"]>),
                        at: v as "submit" | "complete",
                      },
                    })
                  }
                >
                  <SelectTrigger id="num-at" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="submit">상신할 때</SelectItem>
                    <SelectItem value="complete">완료할 때</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">기본 결재선</CardTitle>
          <CardDescription>
            기안 때 처음 채워지는 결재선입니다. 후결 단계는 여기에 있는 만큼만 기안자가 쓸 수
            있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LineEditor rows={rows} onChange={setRows} ctx={ctx} allowPost />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">미리보기</CardTitle>
          <CardDescription>
            기안자가 보게 될 입력 화면입니다. 입력값은 저장되지 않습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {schemaCheck.ok ? (
            <FormFields
              schema={def.schema}
              form={previewForm}
              errors={{}}
              ctx={ctx}
              attachmentSlot={<p className="text-sm text-muted-foreground">(첨부 올리기 영역)</p>}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              필드 정의 오류를 고치면 미리보기가 표시됩니다.
            </p>
          )}
        </CardContent>
      </Card>

      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>저장할 수 없습니다</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {errors.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <div className="sticky bottom-0 flex gap-2 border-t bg-background py-3">
        <Button type="submit" disabled={saving || !schemaCheck.ok}>
          {saving ? "저장 중…" : isNew ? "양식 만들기" : "새 버전으로 저장"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/admin/forms")}>
          목록
        </Button>
      </div>
    </form>
  );
}

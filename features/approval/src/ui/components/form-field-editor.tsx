"use client";
import {
  type FormField,
  USER_DISPLAY_LABEL,
  USER_DISPLAYS,
  type UserDisplay,
} from "@fmerp/shared/domain/form-schema";
import { Button } from "@fmerp/shared/ui/button";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@fmerp/shared/ui/select";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
export const FIELD_TYPE_LABEL: Record<FormField["type"], string> = {
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

export function blankField(type: FormField["type"], n: number): FormField {
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

export function FieldEditor({
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
  const id = useId();
  const [optionIds, setOptionIds] = useState(() =>
    field.type === "select" || field.type === "multiselect"
      ? field.options.map(() => crypto.randomUUID())
      : [],
  );
  const [columnIds, setColumnIds] = useState(() =>
    field.type === "table" ? field.columns.map(() => crypto.randomUUID()) : [],
  );
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
          <Input id={`${id}-key`} value={field.key} disabled maxLength={40} autoComplete="off" />
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
      {field.type === "user" && (
        <div className="max-w-48 space-y-1">
          <Label htmlFor={`${id}-display`}>표시 방식</Label>
          <select
            id={`${id}-display`}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={field.display ?? "name"}
            onChange={(e) => set({ display: e.target.value as UserDisplay })}
          >
            {USER_DISPLAYS.map((d) => (
              <option key={d} value={d}>
                {USER_DISPLAY_LABEL[d]}
              </option>
            ))}
          </select>
        </div>
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
            <div key={optionIds[oi]} className="flex min-w-0 flex-wrap gap-2">
              <Input
                aria-label={`선택지 ${oi + 1} 값`}
                className="w-32 max-w-full"
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
                onClick={() => {
                  setOptionIds((ids) => ids.filter((_, i) => i !== oi));
                  set({ options: field.options.filter((_, xi) => xi !== oi) });
                }}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setOptionIds((ids) => [...ids, crypto.randomUUID()]);
              set({
                options: [
                  ...field.options,
                  {
                    value: `v${field.options.length + 1}`,
                    label: `선택지 ${field.options.length + 1}`,
                  },
                ],
              });
            }}
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
            <div key={columnIds[ci]} className="flex flex-wrap items-center gap-2">
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
                onClick={() => {
                  setColumnIds((ids) => ids.filter((_, i) => i !== ci));
                  set({ columns: field.columns.filter((_, xi) => xi !== ci) });
                }}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setColumnIds((ids) => [...ids, crypto.randomUUID()]);
              set({
                columns: [
                  ...field.columns,
                  {
                    key: `col${field.columns.length + 1}`,
                    label: `열 ${field.columns.length + 1}`,
                    type: "text",
                  },
                ],
              });
            }}
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

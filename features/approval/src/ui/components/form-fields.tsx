"use client";

import { type FormField, type FormSchema, tableSums } from "@fmerp/core";
import type { Department, Member } from "@fmerp/shared/lib/types";
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
import { Textarea } from "@fmerp/shared/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { type Control, Controller, type UseFormReturn } from "react-hook-form";
import { RichTextEditor, RichTextView } from "./rich-text";

export interface FieldContext {
  members: Member[];
  departments: Department[];
}

export type Values = Record<string, unknown>;
const NONE = "__none";

const won = new Intl.NumberFormat("ko-KR");
export const formatWon = (n: number) => `${won.format(n)}원`;

function MoneyInput({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  disabled,
}: {
  id: string;
  value: unknown;
  onChange: (v: number | undefined) => void;
  invalid: boolean;
  describedBy?: string;
  disabled?: boolean;
}) {
  const n = typeof value === "number" ? value : undefined;
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className="pr-8 text-right tabular-nums"
        value={n === undefined ? "" : won.format(n)}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^\d]/g, "");
          onChange(digits === "" ? undefined : Number(digits));
        }}
      />
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">
        원
      </span>
    </div>
  );
}

function cellInput(
  col: { type: "text" | "number" | "money" | "date"; label: string },
  id: string,
  value: unknown,
  onChange: (v: unknown) => void,
  disabled?: boolean,
  invalid = false,
) {
  if (col.type === "money") {
    return (
      <MoneyInput id={id} value={value} onChange={onChange} invalid={invalid} disabled={disabled} />
    );
  }
  return (
    <Input
      id={id}
      aria-label={col.label}
      aria-invalid={invalid}
      disabled={disabled}
      autoComplete="off"
      type={col.type === "date" ? "date" : col.type === "number" ? "number" : "text"}
      inputMode={col.type === "number" ? "decimal" : undefined}
      value={typeof value === "number" ? String(value) : ((value as string | undefined) ?? "")}
      onChange={(e) => {
        const v = e.target.value;
        onChange(col.type === "number" ? (v === "" ? undefined : Number(v)) : v);
      }}
    />
  );
}

function TableField({
  field,
  control,
  schema,
  values,
  errors,
  disabled,
}: {
  field: Extract<FormField, { type: "table" }>;
  control: Control<Values>;
  schema: FormSchema;
  values: Values;
  errors: Record<string, string>;
  disabled?: boolean;
}) {
  const sums = tableSums(schema, values)[field.key] ?? {};
  return (
    <Controller
      control={control}
      name={field.key}
      render={({ field: f }) => {
        const rows = (Array.isArray(f.value) ? f.value : []) as Record<string, unknown>[];
        const setRow = (i: number, key: string, v: unknown) =>
          f.onChange(rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));
        return (
          <div className="space-y-2">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    {field.columns.map((c) => (
                      <th key={c.key} scope="col" className="px-2 py-1.5 font-medium">
                        {c.label}
                        {c.required && <span aria-hidden> *</span>}
                      </th>
                    ))}
                    <th scope="col" className="w-10">
                      <span className="sr-only">행 삭제</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 행은 순서가 곧 식별자다
                    <tr key={i} className="border-t align-top">
                      {field.columns.map((c) => (
                        <td key={c.key} className="min-w-32 p-1">
                          {cellInput(
                            c,
                            `f-${field.key}-${i}-${c.key}`,
                            row[c.key],
                            (v) => setRow(i, c.key, v),
                            disabled,
                            Boolean(errors[`${field.key}[${i}].${c.key}`]),
                          )}
                          {errors[`${field.key}[${i}].${c.key}`] && (
                            <p role="alert" className="mt-0.5 text-xs text-destructive">
                              {errors[`${field.key}[${i}].${c.key}`]}
                            </p>
                          )}
                        </td>
                      ))}
                      <td className="p-1">
                        {!disabled && (
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`${i + 1}행 삭제`}
                            onClick={() => f.onChange(rows.filter((_, idx) => idx !== i))}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={field.columns.length + 1}
                        className="p-3 text-center text-muted-foreground"
                      >
                        행이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
                {Object.keys(sums).length > 0 && (
                  <tfoot className="border-t bg-muted/30">
                    <tr>
                      {field.columns.map((c, idx) => (
                        <td key={c.key} className="px-2 py-1.5 font-medium tabular-nums">
                          {idx === 0 && !c.sum ? "합계" : ""}
                          {c.sum && sums[c.key] !== undefined
                            ? c.type === "money"
                              ? formatWon(sums[c.key] as number)
                              : String(sums[c.key])
                            : ""}
                        </td>
                      ))}
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {!disabled && (field.maxRows === undefined || rows.length < field.maxRows) && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => f.onChange([...rows, {}])}
              >
                <Plus aria-hidden />행 추가
              </Button>
            )}
          </div>
        );
      }}
    />
  );
}

function FieldBody({
  field,
  form,
  schema,
  ctx,
  error,
  attachmentSlot,
  disabled,
  errors,
}: {
  field: FormField;
  form: UseFormReturn<Values>;
  schema: FormSchema;
  ctx: FieldContext;
  error?: string;
  attachmentSlot?: ReactNode;
  disabled?: boolean;
  errors: Record<string, string>;
}) {
  const id = `f-${field.key}`;
  const invalid = Boolean(error);
  const describedBy = invalid ? `${id}-error` : undefined;
  const { control } = form;

  switch (field.type) {
    case "text":
      return (
        <Controller
          control={control}
          name={field.key}
          render={({ field: f }) => (
            <Input
              id={id}
              autoComplete="off"
              disabled={disabled}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              maxLength={field.maxLength}
              value={(f.value as string | undefined) ?? ""}
              onChange={(e) => f.onChange(e.target.value)}
            />
          )}
        />
      );
    case "textarea":
      return (
        <Controller
          control={control}
          name={field.key}
          render={({ field: f }) => (
            <Textarea
              id={id}
              disabled={disabled}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              maxLength={field.maxLength}
              value={(f.value as string | undefined) ?? ""}
              onChange={(e) => f.onChange(e.target.value)}
            />
          )}
        />
      );
    case "number":
      return (
        <Controller
          control={control}
          name={field.key}
          render={({ field: f }) => (
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              disabled={disabled}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              min={field.min}
              max={field.max}
              value={typeof f.value === "number" ? String(f.value) : ""}
              onChange={(e) =>
                f.onChange(e.target.value === "" ? undefined : Number(e.target.value))
              }
            />
          )}
        />
      );
    case "money":
      return (
        <Controller
          control={control}
          name={field.key}
          render={({ field: f }) => (
            <MoneyInput
              id={id}
              value={f.value}
              onChange={f.onChange}
              invalid={invalid}
              describedBy={describedBy}
              disabled={disabled}
            />
          )}
        />
      );
    case "date":
      return (
        <Controller
          control={control}
          name={field.key}
          render={({ field: f }) => (
            <Input
              id={id}
              type="date"
              disabled={disabled}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              value={(f.value as string | undefined) ?? ""}
              onChange={(e) => f.onChange(e.target.value || undefined)}
            />
          )}
        />
      );
    case "daterange":
      return (
        <Controller
          control={control}
          name={field.key}
          render={({ field: f }) => {
            const v = (f.value ?? {}) as { from?: string; to?: string };
            const set = (patch: { from?: string; to?: string }) => {
              const next = { ...v, ...patch };
              f.onChange(next.from || next.to ? next : undefined);
            };
            return (
              // biome-ignore lint/a11y/useSemanticElements: role=group은 라벨과 연결된 컨트롤 묶음이다. fieldset은 라벨 위치 때문에 쓰지 않는다
              <div
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-labelledby={`${id}-label`}
              >
                <Input
                  id={id}
                  type="date"
                  aria-label={`${field.label} 시작일`}
                  disabled={disabled}
                  aria-invalid={invalid}
                  className="w-40"
                  value={v.from ?? ""}
                  onChange={(e) => set({ from: e.target.value || undefined })}
                />
                <span aria-hidden>~</span>
                <Input
                  type="date"
                  aria-label={`${field.label} 종료일`}
                  disabled={disabled}
                  aria-invalid={invalid}
                  className="w-40"
                  value={v.to ?? ""}
                  onChange={(e) => set({ to: e.target.value || undefined })}
                />
              </div>
            );
          }}
        />
      );
    case "select":
      return (
        <Controller
          control={control}
          name={field.key}
          render={({ field: f }) => (
            <Select
              value={(f.value as string | undefined) ?? NONE}
              onValueChange={(v) => f.onChange(v === NONE ? undefined : v)}
              disabled={disabled}
            >
              <SelectTrigger
                id={id}
                className="w-full sm:w-64"
                aria-invalid={invalid}
                aria-describedby={describedBy}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!field.required && <SelectItem value={NONE}>(선택 안 함)</SelectItem>}
                {field.required && f.value === undefined && (
                  <SelectItem value={NONE}>선택하세요</SelectItem>
                )}
                {field.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      );
    case "multiselect":
      return (
        <Controller
          control={control}
          name={field.key}
          render={({ field: f }) => {
            const selected = (Array.isArray(f.value) ? f.value : []) as string[];
            return (
              // biome-ignore lint/a11y/useSemanticElements: role=group은 라벨과 연결된 컨트롤 묶음이다. fieldset은 라벨 위치 때문에 쓰지 않는다
              <div
                className="flex flex-wrap gap-x-4 gap-y-1"
                role="group"
                aria-labelledby={`${id}-label`}
              >
                {field.options.map((o) => (
                  <label key={o.value} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      disabled={disabled}
                      checked={selected.includes(o.value)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...selected, o.value]
                          : selected.filter((x) => x !== o.value);
                        f.onChange(next.length ? next : undefined);
                      }}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            );
          }}
        />
      );
    case "user":
    case "dept": {
      const options =
        field.type === "user"
          ? ctx.members
              .filter((m) => m.status === "active")
              .map((m) => ({ value: m.membershipId, label: m.name }))
          : ctx.departments
              .filter((d) => d.active)
              .map((d) => ({ value: d.id, label: `${"　".repeat(d.depth - 1)}${d.name}` }));
      return (
        <Controller
          control={control}
          name={field.key}
          render={({ field: f }) =>
            field.multiple ? (
              // biome-ignore lint/a11y/useSemanticElements: role=group은 라벨과 연결된 컨트롤 묶음이다. fieldset은 라벨 위치 때문에 쓰지 않는다
              <div
                className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2"
                role="group"
                aria-labelledby={`${id}-label`}
              >
                {options.map((o) => {
                  const selected = (Array.isArray(f.value) ? f.value : []) as string[];
                  return (
                    <label key={o.value} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        className="size-4"
                        disabled={disabled}
                        checked={selected.includes(o.value)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...selected, o.value]
                            : selected.filter((x) => x !== o.value);
                          f.onChange(next.length ? next : undefined);
                        }}
                      />
                      {o.label}
                    </label>
                  );
                })}
              </div>
            ) : (
              <Select
                value={(f.value as string | undefined) ?? NONE}
                onValueChange={(v) => f.onChange(v === NONE ? undefined : v)}
                disabled={disabled}
              >
                <SelectTrigger
                  id={id}
                  className="w-full sm:w-64"
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>(선택 안 함)</SelectItem>
                  {options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          }
        />
      );
    }
    case "table":
      return (
        <TableField
          field={field}
          control={control}
          schema={schema}
          values={form.watch()}
          errors={errors}
          disabled={disabled}
        />
      );
    case "richtext":
      return (
        <Controller
          control={control}
          name={field.key}
          render={({ field: f }) =>
            disabled ? (
              <RichTextView value={f.value as never} />
            ) : (
              <RichTextEditor
                id={id}
                labelledBy={`${id}-label`}
                value={f.value as never}
                onChange={f.onChange}
                invalid={invalid}
                describedBy={describedBy}
              />
            )
          }
        />
      );
    case "attachment":
      return <div>{attachmentSlot}</div>;
  }
}

/** 양식 스키마로 입력 폼을 그린다 (react-hook-form). 검증은 서버와 같은 core 함수(validateFormValues)로 호출 쪽이 한다 */
export function FormFields({
  schema,
  form,
  errors,
  ctx,
  attachmentSlot,
  disabled,
}: {
  schema: FormSchema;
  form: UseFormReturn<Values>;
  errors: Record<string, string>;
  ctx: FieldContext;
  attachmentSlot?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-5">
      {schema.fields.map((field) => {
        const id = `f-${field.key}`;
        const error = errors[field.key];
        const isGroup =
          field.type === "multiselect" ||
          field.type === "richtext" ||
          field.type === "daterange" ||
          (field.type === "user" && field.multiple) ||
          (field.type === "dept" && field.multiple);
        return (
          <div key={field.key} className="space-y-1.5">
            {isGroup || field.type === "table" || field.type === "attachment" ? (
              <p id={`${id}-label`} className="text-sm leading-none font-medium">
                {field.label}
                {field.required && (
                  <span aria-hidden className="text-destructive">
                    {" "}
                    *
                  </span>
                )}
              </p>
            ) : (
              <Label htmlFor={id}>
                {field.label}
                {field.required && (
                  <span aria-hidden className="text-destructive">
                    {" "}
                    *
                  </span>
                )}
              </Label>
            )}
            {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
            <FieldBody
              field={field}
              form={form}
              schema={schema}
              ctx={ctx}
              error={error}
              attachmentSlot={attachmentSlot}
              disabled={disabled}
              errors={errors}
            />
            {error && (
              <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

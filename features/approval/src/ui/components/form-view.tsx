"use client";

import type { FormField, FormSchema } from "@fmerp/shared/domain/form-schema";
import { tableSums } from "@fmerp/shared/domain/form-values";
import type { ReactNode } from "react";
import { type FieldContext, formatWon } from "./form-fields";
import { RichTextView } from "./rich-text";

function display(field: FormField, value: unknown, ctx: FieldContext): ReactNode {
  if (value === undefined || value === null || value === "")
    return <span className="text-muted-foreground">-</span>;
  switch (field.type) {
    case "money":
      return <span className="tabular-nums">{formatWon(value as number)}</span>;
    case "number":
      return <span className="tabular-nums">{String(value)}</span>;
    case "daterange": {
      const r = value as { from?: string; to?: string };
      return `${r.from ?? ""} ~ ${r.to ?? ""}`;
    }
    case "select":
      return field.options.find((o) => o.value === value)?.label ?? String(value);
    case "multiselect":
      return (value as string[])
        .map((v) => field.options.find((o) => o.value === v)?.label ?? v)
        .join(", ");
    case "user": {
      const ids = field.multiple ? (value as string[]) : [value as string];
      return ids
        .map((id) => ctx.members.find((m) => m.membershipId === id)?.name ?? "(알 수 없음)")
        .join(", ");
    }
    case "dept": {
      const ids = field.multiple ? (value as string[]) : [value as string];
      return ids
        .map((id) => ctx.departments.find((d) => d.id === id)?.name ?? "(알 수 없음)")
        .join(", ");
    }
    case "richtext":
      return <RichTextView value={value as never} />;
    case "table": {
      const rows = value as Record<string, unknown>[];
      const sums = tableSums({ fields: [field] }, { [field.key]: rows })[field.key] ?? {};
      return (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                {field.columns.map((c) => (
                  <th key={c.key} scope="col" className="px-2 py-1.5 font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 행은 순서가 곧 식별자다
                <tr key={i} className="border-t">
                  {field.columns.map((c) => (
                    <td key={c.key} className="px-2 py-1.5 tabular-nums">
                      {c.type === "money" && typeof row[c.key] === "number"
                        ? formatWon(row[c.key] as number)
                        : String(row[c.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
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
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      );
    }
    default:
      return <span className="break-words whitespace-pre-wrap">{String(value)}</span>;
  }
}

/** 문서 본문(양식 입력값)을 읽기 전용으로 보여 준다. 첨부는 호출 쪽이 따로 보여 준다 */
export function FormValuesView({
  schema,
  values,
  ctx,
}: {
  schema: FormSchema;
  values: Record<string, unknown>;
  ctx: FieldContext;
}) {
  return (
    <dl className="space-y-4">
      {schema.fields
        .filter((f) => f.type !== "attachment")
        .map((f) => (
          <div key={f.key} className="space-y-1">
            <dt className="text-sm font-medium text-muted-foreground">{f.label}</dt>
            <dd className="min-w-0 text-sm">{display(f, values[f.key], ctx)}</dd>
          </div>
        ))}
    </dl>
  );
}

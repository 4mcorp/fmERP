"use client";

import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type Business,
  type Department,
  type LineItemInput,
  type LineTarget,
  type Member,
  STEP_TYPE_LABEL,
  type StepType,
} from "@/lib/types";

/** 화면에서 다루는 결재선 한 줄. 같은 순번(병렬) 여부는 앞 줄과의 관계(parallelWithPrev)로 표현한다 */
export interface LineRow {
  key: string;
  type: StepType;
  parallelWithPrev: boolean;
  quorum: "all" | number;
  target: LineTarget;
}

export interface LineContext {
  members: Member[];
  departments: Department[];
  businesses: Business[];
}

let counter = 0;
const newKey = () => `row-${++counter}`;

export function itemsToRows(items: LineItemInput[]): LineRow[] {
  const sorted = [...items].sort((a, b) => a.seq - b.seq);
  return sorted.map((item, i) => ({
    key: newKey(),
    type: item.type,
    parallelWithPrev: i > 0 && sorted[i - 1]?.seq === item.seq,
    quorum: item.quorum ?? "all",
    target: item.target,
  }));
}

export function rowsToItems(rows: LineRow[]): LineItemInput[] {
  let seq = 0;
  return rows.map((r, i) => {
    if (i === 0 || !r.parallelWithPrev) seq += 1;
    return { type: r.type, seq, target: r.target, quorum: r.quorum };
  });
}

/** 그룹의 첫 줄만 정족수를 가진다. 나머지 줄에는 같은 값을 복사해 저장한다 */
function normalize(rows: LineRow[]): LineRow[] {
  const out = rows.map((r) => ({ ...r }));
  for (let i = 0; i < out.length; i++) {
    const row = out[i] as LineRow;
    if (i === 0) row.parallelWithPrev = false;
    if (row.parallelWithPrev) row.quorum = (out[i - 1] as LineRow).quorum;
  }
  return out;
}

export function targetLabel(t: LineTarget, ctx: LineContext): string {
  switch (t.kind) {
    case "user":
      return (
        ctx.members.find((m) => m.membershipId === t.membershipId)?.name ?? "(알 수 없는 사용자)"
      );
    case "department": {
      const name =
        ctx.departments.find((d) => d.id === t.departmentId)?.name ?? "(알 수 없는 부서)";
      return `${name} ${t.mode === "head" ? "부서장" : "부서원 중 1명"}`;
    }
    case "drafter_head":
      return (t.levels ?? 1) === 1 ? "기안자의 부서장" : `기안자 상위 ${t.levels}단계 부서장`;
    case "duty":
      return `직책: ${t.dutyName}`;
    case "business_ceo":
      return `${ctx.businesses.find((b) => b.id === t.businessId)?.name ?? "사업자"} ${t.positionName ?? "대표이사"}`;
  }
}

const STEP_TYPES: StepType[] = ["approve", "agree", "cooperate", "audit", "post"];
const TARGET_KINDS: { value: LineTarget["kind"]; label: string }[] = [
  { value: "user", label: "특정 사용자" },
  { value: "department", label: "특정 부서" },
  { value: "drafter_head", label: "기안자의 부서장" },
  { value: "duty", label: "직책" },
  { value: "business_ceo", label: "사업자 대표이사" },
];

function defaultTarget(kind: LineTarget["kind"], ctx: LineContext): LineTarget {
  switch (kind) {
    case "user":
      return {
        kind,
        membershipId: ctx.members.find((m) => m.status === "active")?.membershipId ?? "",
      };
    case "department":
      return { kind, departmentId: ctx.departments.find((d) => d.active)?.id ?? "", mode: "head" };
    case "drafter_head":
      return { kind, levels: 1 };
    case "duty":
      return { kind, dutyName: "" };
    case "business_ceo":
      return { kind, businessId: ctx.businesses.find((b) => b.active)?.id ?? "" };
  }
}

function TargetFields({
  row,
  ctx,
  index,
  onChange,
}: {
  row: LineRow;
  ctx: LineContext;
  index: number;
  onChange: (t: LineTarget) => void;
}) {
  const t = row.target;
  const idp = `line-${index}`;
  switch (t.kind) {
    case "user":
      return (
        <div className="space-y-1">
          <Label htmlFor={`${idp}-user`}>사용자</Label>
          <Select
            value={t.membershipId || undefined}
            onValueChange={(v) => onChange({ kind: "user", membershipId: v })}
          >
            <SelectTrigger id={`${idp}-user`} className="w-full">
              <SelectValue placeholder="선택" />
            </SelectTrigger>
            <SelectContent>
              {ctx.members
                .filter((m) => m.status === "active")
                .map((m) => (
                  <SelectItem key={m.membershipId} value={m.membershipId}>
                    {m.name}
                    {m.assignments.find((a) => a.isPrimary)?.positionName
                      ? ` · ${m.assignments.find((a) => a.isPrimary)?.positionName}`
                      : ""}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      );
    case "department":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`${idp}-dept`}>부서</Label>
            <Select
              value={t.departmentId || undefined}
              onValueChange={(v) => onChange({ ...t, departmentId: v })}
            >
              <SelectTrigger id={`${idp}-dept`} className="w-full">
                <SelectValue placeholder="선택" />
              </SelectTrigger>
              <SelectContent>
                {ctx.departments
                  .filter((d) => d.active)
                  .map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {"　".repeat(d.depth - 1)}
                      {d.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idp}-mode`}>처리자</Label>
            <Select
              value={t.mode}
              onValueChange={(v) => onChange({ ...t, mode: v as "head" | "any" })}
            >
              <SelectTrigger id={`${idp}-mode`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="head">부서장</SelectItem>
                <SelectItem value="any">부서원 중 1명</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );
    case "drafter_head":
      return (
        <div className="space-y-1">
          <Label htmlFor={`${idp}-levels`}>상위 단계</Label>
          <Select
            value={String(t.levels ?? 1)}
            onValueChange={(v) => onChange({ kind: "drafter_head", levels: Number(v) })}
          >
            <SelectTrigger id={`${idp}-levels`} className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n === 1 ? "바로 위 부서장" : `상위 ${n}단계 부서장`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    case "duty":
      return (
        <div className="space-y-1">
          <Label htmlFor={`${idp}-duty`}>직책 이름</Label>
          <Input
            id={`${idp}-duty`}
            value={t.dutyName}
            onChange={(e) => onChange({ kind: "duty", dutyName: e.target.value })}
            placeholder="예: 본부장"
            maxLength={50}
          />
        </div>
      );
    case "business_ceo":
      return (
        <div className="space-y-1">
          <Label htmlFor={`${idp}-biz`}>사업자</Label>
          <Select
            value={t.businessId || undefined}
            onValueChange={(v) => onChange({ kind: "business_ceo", businessId: v })}
          >
            <SelectTrigger id={`${idp}-biz`} className="w-full sm:w-64">
              <SelectValue placeholder="선택" />
            </SelectTrigger>
            <SelectContent>
              {ctx.businesses
                .filter((b) => b.active)
                .map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      );
  }
}

/** 결재란 미리보기: 같은 순번은 한 칸에 묶어 병렬로 보여 준다 (APV-036) */
export function LinePreview({ rows, ctx }: { rows: LineRow[]; ctx: LineContext }) {
  const groups: LineRow[][] = [];
  rows.forEach((r, i) => {
    if (i > 0 && r.parallelWithPrev) groups[groups.length - 1]?.push(r);
    else groups.push([r]);
  });
  return (
    <ol className="flex flex-wrap gap-2" aria-label="결재란 미리보기">
      {groups.map((g, i) => (
        <li key={g[0]?.key} className="min-w-28 rounded-lg border bg-card p-2 text-center text-sm">
          <div className="mb-1 text-xs text-muted-foreground">{i + 1}단계</div>
          {g.map((r) => (
            <div key={r.key} className="space-y-0.5">
              <Badge variant="outline">{STEP_TYPE_LABEL[r.type]}</Badge>
              <div className="break-words">{targetLabel(r.target, ctx)}</div>
            </div>
          ))}
          {g.length > 1 && (
            <div className="mt-1 text-xs text-muted-foreground">
              병렬 {g[0]?.quorum === "all" ? "전원" : `${g[0]?.quorum}명`} 동의
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * 결재선 편집기 (APV-030~032·036): 단계 유형, 대상(사용자·부서·동적), 병렬 그룹·정족수, 순서 변경(끌어놓기·위아래 버튼).
 * 검증과 규칙(양식 수정 허용, 후결 제한)은 서버가 판정하고 오류를 돌려준다.
 */
export function LineEditor({
  rows,
  onChange,
  ctx,
  disabled,
  allowPost = false,
}: {
  rows: LineRow[];
  onChange: (rows: LineRow[]) => void;
  ctx: LineContext;
  disabled?: boolean;
  /** 후결 단계 유형을 고를 수 있는지 (양식 기본 결재선에 후결이 있을 때만) */
  allowPost?: boolean;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const update = (next: LineRow[]) => onChange(normalize(next));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || from === to) return;
    const next = [...rows];
    const [item] = next.splice(from, 1);
    if (item) next.splice(to, 0, item);
    update(next);
  };
  const types = STEP_TYPES.filter((t) => t !== "post" || allowPost);

  return (
    <div className="space-y-3">
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">결재선이 비어 있습니다. 단계를 추가하세요.</p>
      )}
      <ol className="space-y-2">
        {rows.map((row, i) => {
          const groupSize = (() => {
            let start = i;
            while (start > 0 && rows[start]?.parallelWithPrev) start--;
            let end = start;
            while (rows[end + 1]?.parallelWithPrev) end++;
            return { start, size: end - start + 1 };
          })();
          return (
            <li
              key={row.key}
              draggable={!disabled}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", row.key);
                setDragging(row.key);
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => {
                if (dragging && dragging !== row.key) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = rows.findIndex((r) => r.key === e.dataTransfer.getData("text/plain"));
                setDragging(null);
                if (from >= 0) move(from, i);
              }}
              className={`space-y-2 rounded-lg border bg-card p-3 ${dragging === row.key ? "opacity-50" : ""} ${row.parallelWithPrev ? "ml-6 border-dashed" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <GripVertical className="size-4 text-muted-foreground" aria-hidden />
                <span className="text-sm font-medium">{i + 1}번째</span>
                <div className="w-28">
                  <Label htmlFor={`line-${i}-type`} className="sr-only">
                    단계 유형
                  </Label>
                  <Select
                    value={row.type}
                    disabled={disabled}
                    onValueChange={(v) =>
                      update(rows.map((r, idx) => (idx === i ? { ...r, type: v as StepType } : r)))
                    }
                  >
                    <SelectTrigger id={`line-${i}-type`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {types
                        .concat(row.type === "post" && !types.includes("post") ? ["post"] : [])
                        .map((t) => (
                          <SelectItem key={t} value={t}>
                            {STEP_TYPE_LABEL[t]}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-44">
                  <Label htmlFor={`line-${i}-kind`} className="sr-only">
                    대상 방식
                  </Label>
                  <Select
                    value={row.target.kind}
                    disabled={disabled}
                    onValueChange={(v) =>
                      update(
                        rows.map((r, idx) =>
                          idx === i
                            ? { ...r, target: defaultTarget(v as LineTarget["kind"], ctx) }
                            : r,
                        ),
                      )
                    }
                  >
                    <SelectTrigger id={`line-${i}-kind`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TARGET_KINDS.map((k) => (
                        <SelectItem key={k.value} value={k.value}>
                          {k.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {!disabled && (
                  <div className="ml-auto flex gap-1">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`${i + 1}번째 위로`}
                      disabled={i === 0}
                      onClick={() => move(i, i - 1)}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`${i + 1}번째 아래로`}
                      disabled={i === rows.length - 1}
                      onClick={() => move(i, i + 1)}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`${i + 1}번째 삭제`}
                      onClick={() => update(rows.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                )}
              </div>
              <fieldset disabled={disabled} className="min-w-0">
                <TargetFields
                  row={row}
                  ctx={ctx}
                  index={i}
                  onChange={(t) =>
                    update(rows.map((r, idx) => (idx === i ? { ...r, target: t } : r)))
                  }
                />
              </fieldset>
              <div className="flex flex-wrap items-center gap-4">
                {i > 0 && (
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      disabled={disabled}
                      checked={row.parallelWithPrev}
                      onChange={(e) =>
                        update(
                          rows.map((r, idx) =>
                            idx === i ? { ...r, parallelWithPrev: e.target.checked } : r,
                          ),
                        )
                      }
                    />
                    앞 단계와 동시에(병렬)
                  </label>
                )}
                {groupSize.start === i && groupSize.size > 1 && (
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`line-${i}-quorum`} className="text-sm">
                      병렬 완료 조건
                    </Label>
                    <Select
                      value={String(row.quorum)}
                      disabled={disabled}
                      onValueChange={(v) =>
                        update(
                          rows.map((r, idx) =>
                            idx === i ? { ...r, quorum: v === "all" ? "all" : Number(v) } : r,
                          ),
                        )
                      }
                    >
                      <SelectTrigger id={`line-${i}-quorum`} className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">전원 동의</SelectItem>
                        {Array.from({ length: groupSize.size - 1 }, (_, n) => n + 1).map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}명 동의
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {!disabled && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            update([
              ...rows,
              {
                key: newKey(),
                type: "approve",
                parallelWithPrev: false,
                quorum: "all",
                target: defaultTarget("user", ctx),
              },
            ])
          }
        >
          <Plus aria-hidden />
          단계 추가
        </Button>
      )}
      {rows.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">결재란 미리보기</p>
          <LinePreview rows={rows} ctx={ctx} />
        </div>
      )}
    </div>
  );
}

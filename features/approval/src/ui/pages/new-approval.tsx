"use client";

import { ApiProblem, api, errorMessage } from "@fmerp/shared/lib/api";
import {
  useBusinesses,
  useDepartments,
  useForms,
  useMe,
  useMembers,
  useMine,
} from "@fmerp/shared/lib/queries";
import type { FormSummary } from "@fmerp/shared/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@fmerp/shared/ui/alert";
import { Badge } from "@fmerp/shared/ui/badge";
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
import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  itemsToRows,
  LineEditor,
  LinePreview,
  type LineRow,
  rowsToItems,
} from "../components/line-editor";
import { useFormDetail } from "../queries";

function problemLines(error: unknown): string[] {
  if (!(error instanceof ApiProblem)) return [errorMessage(error)];
  const list = error.extensions?.errors;
  if (Array.isArray(list)) {
    return list.map((e) =>
      typeof e === "string" ? e : ((e as { message?: string }).message ?? JSON.stringify(e)),
    );
  }
  return [errorMessage(error)];
}

/** 새 결재: 양식 선택 → 기안 소속·제목·결재선 → 초안 만들기 (APV-010·012·014·033·036) */
export default function NewApprovalPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const { data: forms } = useForms();
  const { data: members } = useMembers();
  const { data: departments } = useDepartments();
  const { data: businesses } = useBusinesses();
  const { data: mine } = useMine();
  const [formId, setFormId] = useState<string | null>(null);
  const { data: detail } = useFormDetail(formId ?? undefined);

  const myMember = members?.find((m) => m.userId === me?.id);
  const assignments = myMember?.assignments ?? [];
  const [assignmentKey, setAssignmentKey] = useState("");
  const [title, setTitle] = useState("");
  const [related, setRelated] = useState<string[]>([]);
  const [rows, setRows] = useState<LineRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!assignmentKey && assignments.length > 0) {
      const primary = assignments.find((a) => a.isPrimary) ?? assignments[0];
      if (primary) setAssignmentKey(primary.departmentId);
    }
  }, [assignmentKey, assignments]);

  useEffect(() => {
    if (detail) setRows(itemsToRows(detail.definition.defaultLine));
  }, [detail]);

  const ctx = useMemo(
    () => ({
      members: members ?? [],
      departments: departments ?? [],
      businesses: businesses ?? [],
    }),
    [members, departments, businesses],
  );

  const grouped = useMemo(() => {
    const byCategory = new Map<string, FormSummary[]>();
    for (const f of forms ?? [])
      byCategory.set(f.category, [...(byCategory.get(f.category) ?? []), f]);
    return [...byCategory.entries()];
  }, [forms]);
  const recent = useMemo(
    () =>
      [...(forms ?? [])]
        .filter((f) => f.lastUsedAt)
        .sort((a, b) => (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? ""))
        .slice(0, 4),
    [forms],
  );
  const favorites = (forms ?? []).filter((f) => f.favorite);

  async function toggleFavorite(f: FormSummary) {
    try {
      await api(`/api/forms/${f.id}/favorite`, { method: "PUT", body: { favorite: !f.favorite } });
      await queryClient.invalidateQueries({ queryKey: ["forms"] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!detail) return;
    const assignment = assignments.find((a) => a.departmentId === assignmentKey);
    if (!assignment) {
      setErrors(["기안 소속(부서)이 없습니다. 관리자에게 발령을 요청하세요."]);
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      const created = await api<{ documentId: string }>("/api/approvals", {
        method: "POST",
        body: {
          businessId: assignment.businessId,
          drafterDepartmentId: assignment.departmentId,
          formId: detail.id,
          title,
          line: detail.definition.allowLineEdit ? rowsToItems(rows) : undefined,
          relatedDocumentIds: related.length ? related : undefined,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["inbox-mine"] });
      router.push(`/approval/draft/${created.documentId}`);
    } catch (error) {
      setErrors(problemLines(error));
    } finally {
      setSaving(false);
    }
  }

  // 홈의 바로가기(?form=<양식 id>)로 들어오면 그 양식을 미리 고른다
  useEffect(() => {
    if (!forms || formId) return;
    const wanted = new URLSearchParams(window.location.search).get("form");
    if (wanted && forms.some((f) => f.id === wanted)) setFormId(wanted);
  }, [forms, formId]);

  if (!forms) return null;

  const FormCard = ({ f }: { f: FormSummary }) => (
    <li className="flex items-stretch gap-1">
      <button
        type="button"
        onClick={() => {
          setFormId(f.id);
          setErrors([]);
        }}
        aria-pressed={formId === f.id}
        className={`flex-1 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted/50 ${formId === f.id ? "border-primary bg-muted/50" : ""}`}
      >
        <span className="font-medium">{f.name}</span>
        <span className="ml-2 text-xs text-muted-foreground">v{f.version}</span>
      </button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={`${f.name} 즐겨찾기 ${f.favorite ? "해제" : "추가"}`}
        aria-pressed={f.favorite}
        onClick={() => toggleFavorite(f)}
      >
        <Star className={f.favorite ? "fill-current" : ""} aria-hidden />
      </Button>
    </li>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">새 결재</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. 양식 선택</CardTitle>
          <CardDescription>
            사용할 양식을 고르세요. 즐겨찾기와 최근 사용한 양식이 위에 표시됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {favorites.length > 0 && (
            <section aria-label="즐겨찾기">
              <h2 className="mb-1 text-sm font-medium">즐겨찾기</h2>
              <ul className="grid gap-1 sm:grid-cols-2">
                {favorites.map((f) => (
                  <FormCard key={f.id} f={f} />
                ))}
              </ul>
            </section>
          )}
          {recent.length > 0 && (
            <section aria-label="최근 사용">
              <h2 className="mb-1 text-sm font-medium">최근 사용</h2>
              <ul className="grid gap-1 sm:grid-cols-2">
                {recent.map((f) => (
                  <FormCard key={f.id} f={f} />
                ))}
              </ul>
            </section>
          )}
          {grouped.map(([category, list]) => (
            <section key={category} aria-label={category}>
              <h2 className="mb-1 text-sm font-medium">{category}</h2>
              <ul className="grid gap-1 sm:grid-cols-2">
                {list.map((f) => (
                  <FormCard key={f.id} f={f} />
                ))}
              </ul>
            </section>
          ))}
          {forms.length === 0 && (
            <p className="text-sm text-muted-foreground">사용할 수 있는 양식이 없습니다.</p>
          )}
        </CardContent>
      </Card>

      {detail && (
        <form onSubmit={create} className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. 기본 정보 — {detail.name}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="doc-title">제목</Label>
                <Input
                  id="doc-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  required
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="doc-assignment">기안 소속</Label>
                <Select value={assignmentKey || undefined} onValueChange={setAssignmentKey}>
                  <SelectTrigger id="doc-assignment" className="w-full">
                    <SelectValue placeholder="소속 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {assignments.map((a) => (
                      <SelectItem key={a.departmentId} value={a.departmentId}>
                        {a.businessName} · {a.departmentName}
                        {a.isPrimary ? " (주소속)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <fieldset className="space-y-1">
                <legend className="mb-1 text-sm leading-none font-medium">관련 문서 (선택)</legend>
                <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {(mine ?? []).slice(0, 20).map((d) => (
                    <label key={d.id} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={related.includes(d.id)}
                        onChange={(e) =>
                          setRelated((r) =>
                            e.target.checked ? [...r, d.id] : r.filter((x) => x !== d.id),
                          )
                        }
                      />
                      <span className="min-w-0 break-words">{d.title}</span>
                    </label>
                  ))}
                  {(mine ?? []).length === 0 && (
                    <p className="text-sm text-muted-foreground">연결할 문서가 없습니다.</p>
                  )}
                </div>
              </fieldset>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">3. 결재선</CardTitle>
              <CardDescription>
                {detail.definition.allowLineEdit
                  ? "양식의 기본 결재선입니다. 필요하면 바꿀 수 있습니다."
                  : "이 양식은 결재선을 바꿀 수 없습니다. 기본 결재선이 적용됩니다."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {detail.definition.allowLineEdit ? (
                <LineEditor
                  rows={rows}
                  onChange={setRows}
                  ctx={ctx}
                  allowPost={detail.definition.defaultLine.some((i) => i.type === "post")}
                />
              ) : (
                <LinePreview rows={rows} ctx={ctx} />
              )}
            </CardContent>
          </Card>

          {errors.length > 0 && (
            <Alert variant="destructive">
              <AlertTitle>초안을 만들 수 없습니다</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {errors.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={saving}>
            {saving ? "만드는 중…" : "작성 시작"}
          </Button>
          {detail.definition.numbering && (
            <Badge variant="outline" className="ml-2">
              문서번호 자동 부여
            </Badge>
          )}
        </form>
      )}
    </div>
  );
}

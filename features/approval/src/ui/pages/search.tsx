"use client";

import { ApiProblem, errorMessage } from "@fmerp/shared/lib/api";
import { useDepartments, useForms } from "@fmerp/shared/lib/queries";
import { DOC_STATUS_LABEL } from "@fmerp/shared/lib/types";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent } from "@fmerp/shared/ui/card";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import { PageHeader } from "@fmerp/shared/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@fmerp/shared/ui/select";
import { Download, Search as SearchIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";
import { toast } from "sonner";
import { DocumentTable } from "../components/document-table";
import { useSearch } from "../queries";

const FILTER_KEYS = [
  "q",
  "drafter",
  "departmentId",
  "formId",
  "status",
  "from",
  "to",
  "minAmount",
  "maxAmount",
] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Filters = Record<FilterKey, string>;

const ALL = "all";
const SEARCH_STATUSES = [
  "IN_PROGRESS",
  "COMPLETED",
  "ON_HOLD",
  "REJECTED",
  "WITHDRAWN",
  "CANCELED",
];

const fromParams = (p: URLSearchParams): Filters =>
  Object.fromEntries(FILTER_KEYS.map((k) => [k, p.get(k) ?? ""])) as Filters;

/** 비어 있지 않은 조건만 쿼리 문자열로 만든다 */
const toQuery = (f: Filters) => {
  const out = new URLSearchParams();
  for (const k of FILTER_KEYS) if (f[k].trim() !== "") out.set(k, f[k].trim());
  return out.toString();
};

/** 문서 검색 (APV-082): 제목·문서번호·본문·첨부 파일명 글자와 기안자·부서·양식·상태·기간·금액 조건. 결과는 열람 권한 안에서만 나온다 */
function SearchView() {
  const router = useRouter();
  const params = useSearchParams();
  const applied = toQuery(fromParams(params));
  const [form, setForm] = useState<Filters>(() => fromParams(params));
  const { data: departments } = useDepartments();
  const { data: forms } = useForms(true);
  const query = useSearch(applied);
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const set = (key: FilterKey) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const qs = toQuery(form);
    router.replace(qs ? `/search?${qs}` : "/search");
  }

  function reset() {
    const empty = fromParams(new URLSearchParams());
    setForm(empty);
    router.replace("/search");
  }

  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);

  /** 지금 검색 조건 그대로 CSV·엑셀로 내려받는다. 10,000건을 넘으면 서버가 거부하고 안내 문구를 준다 (APV-083) */
  async function exportAs(format: "csv" | "xlsx") {
    setExporting(format);
    try {
      const res = await fetch(`/api/search/export?format=${format}&${applied}`);
      if (!res.ok) {
        const problem = (await res.json().catch(() => ({}))) as { title?: string };
        throw new Error(problem.title ?? "내보내지 못했습니다");
      }
      const blob = await res.blob();
      const name = /filename\*=UTF-8''([^;]+)/.exec(
        res.headers.get("content-disposition") ?? "",
      )?.[1];
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = name ? decodeURIComponent(name) : `문서목록.${format}`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success("내보냈습니다. 내보낸 기록이 남습니다");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(null);
    }
  }

  const error =
    query.error instanceof ApiProblem && query.error.status === 400
      ? "검색 조건을 확인하세요."
      : query.error
        ? errorMessage(query.error)
        : null;

  return (
    <div className="space-y-4">
      <PageHeader title="검색" />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2 sm:col-span-2 lg:col-span-3">
              <Label htmlFor="s-q">검색어</Label>
              <Input
                id="s-q"
                type="search"
                autoComplete="off"
                value={form.q}
                onChange={(e) => set("q")(e.target.value)}
                placeholder="제목, 문서번호, 본문, 첨부 파일명…"
                maxLength={100}
              />
              <p className="text-xs text-muted-foreground">
                3글자 이상이면 본문과 첨부 파일명까지 찾고, 2글자 이하는 제목·문서번호의 앞부분만
                찾습니다.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-drafter">기안자</Label>
              <Input
                id="s-drafter"
                value={form.drafter}
                onChange={(e) => set("drafter")(e.target.value)}
                maxLength={50}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-dept">기안 부서</Label>
              <Select
                value={form.departmentId || ALL}
                onValueChange={(v) => set("departmentId")(v === ALL ? "" : v)}
              >
                <SelectTrigger id="s-dept" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>전체</SelectItem>
                  {(departments ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-form">양식</Label>
              <Select
                value={form.formId || ALL}
                onValueChange={(v) => set("formId")(v === ALL ? "" : v)}
              >
                <SelectTrigger id="s-form" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>전체</SelectItem>
                  {(forms ?? []).map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-status">상태</Label>
              <Select
                value={form.status || ALL}
                onValueChange={(v) => set("status")(v === ALL ? "" : v)}
              >
                <SelectTrigger id="s-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>전체</SelectItem>
                  {SEARCH_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {DOC_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-from">상신일 (시작)</Label>
              <Input
                id="s-from"
                type="date"
                value={form.from}
                onChange={(e) => set("from")(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-to">상신일 (끝)</Label>
              <Input
                id="s-to"
                type="date"
                value={form.to}
                onChange={(e) => set("to")(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-min">금액 (원, 이상)</Label>
              <Input
                id="s-min"
                type="number"
                min={0}
                inputMode="numeric"
                value={form.minAmount}
                onChange={(e) => set("minAmount")(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-max">금액 (원, 이하)</Label>
              <Input
                id="s-max"
                type="number"
                min={0}
                inputMode="numeric"
                value={form.maxAmount}
                onChange={(e) => set("maxAmount")(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
              <Button type="submit">
                <SearchIcon aria-hidden />
                검색
              </Button>
              <Button type="button" variant="outline" onClick={reset}>
                조건 지우기
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {applied === "" ? (
        <p className="text-sm text-muted-foreground">
          검색어나 조건을 입력하고 검색하세요. 내가 열람할 수 있는 문서만 나옵니다.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportAs("csv")}
              disabled={exporting !== null || rows.length === 0}
            >
              <Download aria-hidden />
              {exporting === "csv" ? "내보내는 중…" : "CSV 내보내기"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportAs("xlsx")}
              disabled={exporting !== null || rows.length === 0}
            >
              <Download aria-hidden />
              {exporting === "xlsx" ? "내보내는 중…" : "엑셀 내보내기"}
            </Button>
            <p className="text-xs text-muted-foreground">
              현재 조건에 맞는 문서를 최대 10,000건까지 내보냅니다.
            </p>
          </div>
          <DocumentTable
            rows={rows}
            loading={query.isLoading}
            hasMore={Boolean(query.hasNextPage)}
            loadingMore={query.isFetchingNextPage}
            onMore={() => query.fetchNextPage()}
            emptyText="조건에 맞는 문서가 없습니다."
          />
        </>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchView />
    </Suspense>
  );
}

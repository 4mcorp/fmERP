"use client";

import { ApiProblem, errorMessage } from "@fmerp/shared/lib/api";
import { formatDateTime } from "@fmerp/shared/lib/format";
import { ActionBar } from "@fmerp/shared/ui/action-bar";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent } from "@fmerp/shared/ui/card";
import { DataTable, type DataTableColumn, type DataTableFilter } from "@fmerp/shared/ui/data-table";
import { EmptyState } from "@fmerp/shared/ui/empty-state";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import { Modal } from "@fmerp/shared/ui/modal";
import { PageHeader } from "@fmerp/shared/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@fmerp/shared/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@fmerp/shared/ui/table";
import { ScrollText, Search as SearchIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";
import { AuditTabs } from "../components/audit-tabs";
import {
  AUDIT_ACTION_GROUPS,
  AUDIT_ACTION_LABEL,
  type AuditLogRow,
  useAuditActors,
  useAuditLogs,
} from "../queries";

const FILTER_KEYS = ["from", "to", "action", "actorUserId", "targetId", "result"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Filters = Record<FilterKey, string>;

const ALL = "all";
const DAY_MS = 86_400_000;

const fromParams = (p: URLSearchParams): Filters =>
  Object.fromEntries(FILTER_KEYS.map((k) => [k, p.get(k) ?? ""])) as Filters;

/** 화면 조건(URL 상태)을 API 쿼리로. 날짜는 한국 시간 하루 단위로 해석하고, 끝 날짜는 그날 끝까지 포함한다 */
function toApiQuery(f: Filters): string {
  const out = new URLSearchParams();
  if (f.from) out.set("from", new Date(`${f.from}T00:00:00+09:00`).toISOString());
  if (f.to) {
    out.set("to", new Date(new Date(`${f.to}T00:00:00+09:00`).getTime() + DAY_MS).toISOString());
  }
  for (const k of ["action", "actorUserId", "result"] as const) if (f[k]) out.set(k, f[k]);
  if (f.targetId.trim()) out.set("targetId", f.targetId.trim());
  return out.toString();
}

const toUrlQuery = (f: Filters) => {
  const out = new URLSearchParams();
  for (const k of FILTER_KEYS) if (f[k].trim() !== "") out.set(k, f[k].trim());
  return out.toString();
};

const actionLabel = (action: string) => AUDIT_ACTION_LABEL[action] ?? action;

const show = (v: unknown) => {
  if (v === undefined) return "—";
  const text = typeof v === "string" ? v : JSON.stringify(v);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
};

interface DiffEntry {
  op: "add" | "remove" | "change";
  path: string;
  value?: unknown;
  oldValue?: unknown;
}

function Detail({ row, onClose }: { row: AuditLogRow | null; onClose: () => void }) {
  const diff = Array.isArray(row?.diff) ? (row?.diff as DiffEntry[]) : [];
  const fields: [string, string | null][] = row
    ? [
        ["일시", formatDateTime(row.occurredAt)],
        ["행위자", row.actorName ?? "시스템"],
        ["대리 처리 원 권한자", row.onBehalfOfName],
        ["행위", `${actionLabel(row.action)} (${row.action})`],
        ["대상", row.targetType ? `${row.targetType} · ${row.targetLabel ?? row.targetId}` : null],
        ["대상 ID", row.targetId],
        ["정보주체", row.subjectName],
        ["결과", row.result === "success" ? "성공" : "실패"],
        ["사유·메모", row.reason],
        ["접속지(IP)", row.ip],
        ["브라우저", row.userAgent],
        ["요청 ID", row.requestId],
      ]
    : [];
  return (
    <Modal open={row !== null} onClose={onClose} title="감사 로그 상세" className="max-w-2xl">
      {row?.masked && (
        <p className="mb-3 rounded-md bg-muted p-2 text-sm text-muted-foreground">
          문서를 열람할 권한이 없어 제목·결재 의견·첨부 이름은 가렸습니다. (관리자는 문서 내용을 볼
          수 없습니다)
        </p>
      )}
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
        {fields
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-all">{v}</dd>
            </div>
          ))}
      </dl>
      {diff.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-medium">변경 내용</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">항목</TableHead>
                <TableHead scope="col">변경 전</TableHead>
                <TableHead scope="col">변경 후</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diff.map((d) => (
                <TableRow key={d.path}>
                  <TableCell className="break-all">{d.path}</TableCell>
                  <TableCell className="break-all">
                    {d.op === "add" ? "—" : show(d.oldValue)}
                  </TableCell>
                  <TableCell className="break-all">
                    {d.op === "remove" ? "—" : show(d.value)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="outline" onClick={onClose}>
          닫기
        </Button>
      </div>
    </Modal>
  );
}

const RESULT_FILTER: DataTableFilter<AuditLogRow> = {
  id: "result",
  label: "결과",
  allLabel: "결과 전체",
  options: [
    { value: "success", label: "성공" },
    { value: "failure", label: "실패" },
  ],
  predicate: (r, v) => r.result === v,
};

/**
 * 감사 로그 조회 (AUD-025): 기간·행위자·행위 유형·대상으로 걸러 본다.
 * 계정 범위 감사 권한자(소유자·관리자·감사인)만 열 수 있고, 조회한 사실도 로그에 남는다.
 */
function AuditLogView() {
  const router = useRouter();
  const params = useSearchParams();
  const applied = fromParams(params);
  const [form, setForm] = useState<Filters>(() => applied);
  const [selected, setSelected] = useState<AuditLogRow | null>(null);
  const { data: members } = useAuditActors();
  const query = useAuditLogs(toApiQuery(applied), true);
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const columns: DataTableColumn<AuditLogRow>[] = [
    {
      id: "occurredAt",
      header: "일시",
      sortValue: (r) => r.occurredAt,
      cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.occurredAt)}</span>,
    },
    {
      id: "actor",
      header: "행위자",
      sortValue: (r) => r.actorName ?? "시스템",
      cell: (r) => r.actorName ?? "시스템",
    },
    {
      id: "action",
      header: "행위",
      sortValue: (r) => actionLabel(r.action),
      cell: (r) => actionLabel(r.action),
    },
    {
      id: "target",
      header: "대상",
      hideBelow: "sm",
      className: "max-w-64 truncate",
      cell: (r) =>
        r.masked ? (
          <span className="text-muted-foreground">문서 내용 가림 · {r.targetId}</span>
        ) : (
          <span title={r.targetLabel ?? r.targetId ?? undefined}>
            {r.targetLabel ?? r.targetId ?? "—"}
          </span>
        ),
    },
    {
      id: "result",
      header: "결과",
      cell: (r) =>
        r.result === "success" ? (
          <Badge variant="success">성공</Badge>
        ) : (
          <Badge variant="danger">실패</Badge>
        ),
    },
    {
      id: "detail",
      header: "상세",
      cell: (r) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setSelected(r);
          }}
          aria-label={`${formatDateTime(r.occurredAt)} ${actionLabel(r.action)} 상세 보기`}
        >
          상세
        </Button>
      ),
    },
  ];
  const set = (key: FilterKey) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const forbidden = query.error instanceof ApiProblem && query.error.status === 403;

  function submit(e: FormEvent) {
    e.preventDefault();
    const qs = toUrlQuery(form);
    router.replace(qs ? `/admin/audit?${qs}` : "/admin/audit");
  }

  function reset() {
    setForm(fromParams(new URLSearchParams()));
    router.replace("/admin/audit");
  }

  if (forbidden) {
    return (
      <p role="alert" className="text-muted-foreground">
        감사 로그를 볼 권한이 없습니다. (계정 범위 감사 권한이 필요합니다)
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="감사 로그" description="기간·행위자·행위 유형·대상으로 걸러 봅니다." />
      <AuditTabs />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="a-from">시작일</Label>
              <Input
                id="a-from"
                type="date"
                value={form.from}
                onChange={(e) => set("from")(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-to">끝일</Label>
              <Input
                id="a-to"
                type="date"
                value={form.to}
                onChange={(e) => set("to")(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-action">행위 유형</Label>
              <Select
                value={form.action || ALL}
                onValueChange={(v) => set("action")(v === ALL ? "" : v)}
              >
                <SelectTrigger id="a-action" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>전체</SelectItem>
                  {AUDIT_ACTION_GROUPS.map((g) => (
                    <SelectItem key={g.value} value={g.value}>
                      {g.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-actor">행위자</Label>
              <Select
                value={form.actorUserId || ALL}
                onValueChange={(v) => set("actorUserId")(v === ALL ? "" : v)}
              >
                <SelectTrigger id="a-actor" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>전체</SelectItem>
                  {(members ?? []).map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-target">대상 ID</Label>
              <Input
                id="a-target"
                name="targetId"
                autoComplete="off"
                spellCheck={false}
                value={form.targetId}
                onChange={(e) => set("targetId")(e.target.value)}
                maxLength={100}
                placeholder="문서 ID 등…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-result">결과</Label>
              <Select
                value={form.result || ALL}
                onValueChange={(v) => set("result")(v === ALL ? "" : v)}
              >
                <SelectTrigger id="a-result" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>전체</SelectItem>
                  <SelectItem value="success">성공</SelectItem>
                  <SelectItem value="failure">실패</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-2 sm:col-span-2 lg:col-span-3">
              <p className="text-xs text-muted-foreground">
                시작일을 비우면 최근 30일을 보여 줍니다. 조회한 사실도 로그에 남습니다.
              </p>
              <ActionBar>
                <Button type="button" variant="outline" onClick={reset}>
                  조건 지우기
                </Button>
                <Button type="submit" variant="default">
                  <SearchIcon aria-hidden />
                  조회
                </Button>
              </ActionBar>
            </div>
          </form>
        </CardContent>
      </Card>

      {query.error && !forbidden && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(query.error)}
        </p>
      )}
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        caption="감사 로그 목록"
        isLoading={query.isPending}
        columns={columns}
        search={{
          placeholder: "불러온 기록에서 검색…",
          text: (r) =>
            `${r.actorName ?? "시스템"} ${actionLabel(r.action)} ${r.masked ? "" : (r.targetLabel ?? "")} ${r.targetId ?? ""}`,
        }}
        filters={[RESULT_FILTER]}
        onRowClick={setSelected}
        empty={
          <EmptyState
            icon={ScrollText}
            title="조건에 맞는 기록이 없습니다"
            description="기간이나 조건을 바꿔 다시 조회해 보세요."
          />
        }
      />
      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? "불러오는 중…" : "더 보기"}
          </Button>
        </div>
      )}
      <Detail row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

export default function AuditLogPage() {
  return (
    <Suspense>
      <AuditLogView />
    </Suspense>
  );
}

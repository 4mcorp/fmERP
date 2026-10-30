"use client";

import { ApiProblem, api, errorMessage } from "@fmerp/shared/lib/api";
import { useMembers } from "@fmerp/shared/lib/queries";
import type { Department } from "@fmerp/shared/lib/types";
import { ActionBar } from "@fmerp/shared/ui/action-bar";
import { Alert, AlertDescription, AlertTitle } from "@fmerp/shared/ui/alert";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { ConfirmDialog } from "@fmerp/shared/ui/confirm-dialog";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import { LoadingState } from "@fmerp/shared/ui/loading-state";
import { PageHeader } from "@fmerp/shared/ui/page-header";
import { QueryErrorState } from "@fmerp/shared/ui/query-error-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@fmerp/shared/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { Download, GripVertical, Upload } from "lucide-react";
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { buildDeptTree, type DeptTreeNode } from "../org-tree";
import { useOrgChart } from "../queries";

const NONE = "__none";

type Panel =
  | { mode: "create"; parentId: string | null }
  | { mode: "edit"; dept: Department }
  | null;

interface ImportError {
  line: number;
  message: string;
}

function DepartmentForm({
  businessId,
  maxDepth,
  departments,
  panel,
  onDone,
}: {
  businessId: string;
  maxDepth: number;
  departments: Department[];
  panel: NonNullable<Panel>;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: members } = useMembers();
  const editing = panel.mode === "edit" ? panel.dept : null;
  const [code, setCode] = useState(editing?.code ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [shortName, setShortName] = useState(editing?.shortName ?? "");
  const [sort, setSort] = useState(String(editing?.sort ?? 0));
  const initialParent =
    panel.mode === "create" ? (panel.parentId ?? NONE) : (panel.dept.parentId ?? NONE);
  const [parentId, setParentId] = useState(initialParent);
  // 이동 후보에서 자기 자신과 하위 부서는 뺀다 (키보드·모바일에서는 끌어놓기 대신 이 선택을 쓴다)
  const blocked = new Set<string>();
  if (editing) {
    blocked.add(editing.id);
    for (let grew = true; grew; ) {
      grew = false;
      for (const d of departments) {
        if (d.parentId && blocked.has(d.parentId) && !blocked.has(d.id)) {
          blocked.add(d.id);
          grew = true;
        }
      }
    }
  }
  const [head, setHead] = useState(editing?.headMembershipId ?? NONE);
  const [saving, setSaving] = useState(false);

  const parentDepth =
    parentId === NONE ? 0 : (departments.find((d) => d.id === parentId)?.depth ?? 0);
  const tooDeep = parentDepth + 1 > maxDepth && parentId !== initialParent;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const common = {
        code,
        name,
        shortName: shortName || null,
        sort: Number(sort),
        headMembershipId: head === NONE ? null : head,
      };
      if (editing) {
        if (parentId !== initialParent) {
          await api(`/api/departments/${editing.id}/move`, {
            method: "POST",
            body: { newParentId: parentId === NONE ? null : parentId },
          });
        }
        await api(`/api/departments/${editing.id}`, { method: "PATCH", body: common });
      } else {
        await api("/api/departments", {
          method: "POST",
          body: { ...common, businessId, parentId: parentId === NONE ? null : parentId },
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["org-chart"] });
      await queryClient.invalidateQueries({ queryKey: ["departments"] });
      toast.success(editing ? "부서를 수정했습니다" : "부서를 만들었습니다");
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {editing ? `${editing.name} 수정` : "부서 만들기"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {
              <div className="space-y-2">
                <Label htmlFor="d-parent">
                  {editing ? "상위 부서 (변경하면 이동)" : "상위 부서"}
                </Label>
                <Select value={parentId} onValueChange={setParentId}>
                  <SelectTrigger id="d-parent" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>(최상위)</SelectItem>
                    {departments
                      .filter((d) => !blocked.has(d.id))
                      .map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {"　".repeat(d.depth - 1)}
                          {d.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            }
            <div className="space-y-2">
              <Label htmlFor="d-name">부서명</Label>
              <Input
                id="d-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="d-code">부서 코드 (사업자 안에서 고유)</Label>
              <Input
                id="d-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                pattern="[A-Za-z0-9_\-]{1,20}"
                title="영문·숫자·-·_ 20자 이하"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="d-short">약칭</Label>
              <Input
                id="d-short"
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
                maxLength={30}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="d-sort">정렬 순서</Label>
              <Input
                id="d-sort"
                type="number"
                min={0}
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="d-head">부서장</Label>
              <Select value={head} onValueChange={setHead}>
                <SelectTrigger id="d-head" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>(없음)</SelectItem>
                  {members
                    ?.filter((m) => m.status === "active")
                    .map((m) => (
                      <SelectItem key={m.membershipId} value={m.membershipId}>
                        {m.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {tooDeep && (
            <p role="alert" className="text-sm text-destructive">
              최대 {maxDepth}단계까지 만들 수 있습니다. 계정 설정에서 최대 뎁스를 높일 수 있습니다.
            </p>
          )}
          <ActionBar>
            <Button type="button" variant="outline" onClick={onDone}>
              취소
            </Button>
            <Button type="submit" variant="default" disabled={saving || tooDeep}>
              {saving ? "저장 중…" : editing ? "저장" : "만들기"}
            </Button>
          </ActionBar>
        </form>
      </CardContent>
    </Card>
  );
}

function Row({
  node,
  maxDepth,
  dragging,
  setDragging,
  onMove,
  onPanel,
  onChanged,
}: {
  node: DeptTreeNode;
  maxDepth: number;
  dragging: string | null;
  setDragging: (id: string | null) => void;
  onMove: (id: string, newParentId: string | null) => void;
  onPanel: (p: Panel) => void;
  onChanged: () => Promise<void>;
}) {
  const canAddChild = node.depth < maxDepth;

  const [confirmingAbolish, setConfirmingAbolish] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function toggleActive() {
    try {
      await api(`/api/departments/${node.id}/${node.active ? "deactivate" : "activate"}`, {
        method: "POST",
      });
      await onChanged();
      toast.success(node.active ? "부서를 폐지했습니다" : "부서를 다시 사용합니다");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function remove() {
    try {
      await api(`/api/departments/${node.id}`, { method: "DELETE" });
      await onChanged();
      toast.success("부서를 삭제했습니다");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <li>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 끌어놓기는 보조 수단이다. 같은 이동을 수정 화면의 상위 부서 선택으로도 할 수 있다 */}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", node.id);
          setDragging(node.id);
        }}
        onDragEnd={() => setDragging(null)}
        onDragOver={(e) => {
          if (dragging && dragging !== node.id) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/plain");
          setDragging(null);
          if (id && id !== node.id) onMove(id, node.id);
        }}
        className={`flex flex-wrap items-center gap-2 rounded-md border bg-card px-2 py-1.5 ${
          dragging === node.id ? "opacity-50" : ""
        }`}
      >
        <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-medium">{node.name}</span>
        <span className="text-xs text-muted-foreground">{node.code}</span>
        <Badge variant="outline">{node.depth}단계</Badge>
        <Badge variant="secondary">{node.memberCount}명</Badge>
        {!node.active && <Badge variant="outline">폐지</Badge>}
        <div className="ml-auto flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={!canAddChild}
            aria-label={`${node.name} 하위 추가`}
            title={canAddChild ? undefined : `최대 ${maxDepth}단계까지 만들 수 있습니다`}
            onClick={() => onPanel({ mode: "create", parentId: node.id })}
          >
            하위 추가
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label={`${node.name} 수정`}
            onClick={() => onPanel({ mode: "edit", dept: node })}
          >
            수정
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label={`${node.name} ${node.active ? "폐지" : "다시 사용"}`}
            onClick={() => (node.active ? setConfirmingAbolish(true) : toggleActive())}
          >
            {node.active ? "폐지" : "다시 사용"}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            aria-label={`${node.name} 삭제`}
            onClick={() => setConfirmingDelete(true)}
          >
            삭제
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmingAbolish}
        title={`${node.name} 부서를 폐지할까요?`}
        description="폐지하면 새 발령에 이 부서를 고를 수 없습니다. 언제든 다시 사용할 수 있습니다."
        confirmLabel="폐지"
        onConfirm={() => toggleActive()}
        onClose={() => setConfirmingAbolish(false)}
      />
      <ConfirmDialog
        open={confirmingDelete}
        title={`${node.name} 부서를 삭제할까요?`}
        description="삭제하면 되돌릴 수 없습니다."
        confirmLabel="삭제"
        onConfirm={() => remove()}
        onClose={() => setConfirmingDelete(false)}
      />
      {node.children.length > 0 && (
        <ul className="mt-1 ml-5 space-y-1 border-l pl-3">
          {node.children.map((c) => (
            <Row
              key={c.id}
              node={c}
              maxDepth={maxDepth}
              dragging={dragging}
              setDragging={setDragging}
              onMove={onMove}
              onPanel={onPanel}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** 부서 트리 편집: 생성·수정·이동(드래그 앤 드롭)·폐지·삭제, CSV 내보내기·가져오기 (PRD ORG-010~016) */
export default function AdminOrgPage() {
  const queryClient = useQueryClient();
  const { data: chart, isLoading, isError, refetch } = useOrgChart();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<ImportError[] | null>(null);

  useEffect(() => {
    if (!businessId && chart?.businesses[0]) setBusinessId(chart.businesses[0].id);
  }, [businessId, chart]);

  const business = chart?.businesses.find((b) => b.id === businessId);
  const tree = useMemo(() => buildDeptTree(business?.departments ?? []), [business]);
  if (isError) return <QueryErrorState onRetry={() => void refetch()} />;
  if (isLoading || !chart) return <LoadingState />;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["org-chart"] });
    await queryClient.invalidateQueries({ queryKey: ["departments"] });
  }

  async function move(id: string, newParentId: string | null) {
    try {
      await api(`/api/departments/${id}/move`, { method: "POST", body: { newParentId } });
      await refresh();
      toast.success("부서를 이동했습니다");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function onImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !businessId) return;
    setImportErrors(null);
    try {
      const csv = await file.text();
      const result = await api<{ created: number }>("/api/departments/import", {
        method: "POST",
        body: { businessId, csv },
      });
      await refresh();
      toast.success(`${result.created}개 부서를 가져왔습니다`);
    } catch (error) {
      if (error instanceof ApiProblem && error.code === "import_invalid") {
        setImportErrors((error.extensions?.errors as ImportError[] | undefined) ?? []);
      }
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="조직 관리"
        breadcrumbs={[{ label: "관리" }, { label: "조직 관리" }]}
        className="pb-0"
      />

      {chart.businesses.length === 0 ? (
        <p className="text-muted-foreground">먼저 사업자를 등록하세요.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="org-business">사업자</Label>
              <Select
                value={businessId ?? ""}
                onValueChange={(v) => {
                  setBusinessId(v);
                  setPanel(null);
                  setImportErrors(null);
                }}
              >
                <SelectTrigger id="org-business" className="w-56">
                  <SelectValue placeholder="사업자 선택" />
                </SelectTrigger>
                <SelectContent>
                  {chart.businesses.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                      {b.active ? "" : " (비활성)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ActionBar className="ml-auto flex-1 basis-full sm:basis-auto">
              <Button variant="outline" asChild>
                <a href={`/api/departments/export?businessId=${businessId ?? ""}`} download>
                  <Download className="size-4" aria-hidden />
                  CSV 내보내기
                </a>
              </Button>
              <Label htmlFor="org-import" className="sr-only">
                CSV 가져오기
              </Label>
              <Button variant="outline" asChild>
                <label htmlFor="org-import" className="cursor-pointer">
                  <Upload className="size-4" aria-hidden />
                  CSV 가져오기
                </label>
              </Button>
              <input
                id="org-import"
                type="file"
                accept=".csv,text/csv"
                onChange={onImport}
                className="sr-only"
              />
              <Button onClick={() => setPanel({ mode: "create", parentId: null })}>
                최상위 부서 추가
              </Button>
            </ActionBar>
          </div>
          <p className="text-sm text-muted-foreground">
            최대 {chart.maxDeptDepth}단계. 부서를 끌어서 다른 부서 위에 놓으면 그 아래로 이동합니다.
          </p>

          {importErrors && (
            <Alert variant="destructive">
              <AlertTitle>CSV에 오류가 있어 가져오지 않았습니다</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {importErrors.map((er) => (
                    <li key={`${er.line}-${er.message}`}>
                      {er.line}줄: {er.message}
                    </li>
                  ))}
                </ul>
                <p className="mt-1">형식: code,name,parentCode,shortName,sort (첫 줄은 머리글)</p>
              </AlertDescription>
            </Alert>
          )}

          {panel && businessId && (
            <DepartmentForm
              key={panel.mode === "edit" ? panel.dept.id : `new-${panel.parentId}`}
              businessId={businessId}
              maxDepth={chart.maxDeptDepth}
              departments={business?.departments ?? []}
              panel={panel}
              onDone={() => setPanel(null)}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{business?.name}</CardTitle>
              <CardDescription>부서 {business?.departments.length ?? 0}개</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {dragging && (
                // biome-ignore lint/a11y/noStaticElementInteractions: 끌어놓기는 보조 수단이다. 같은 이동을 수정 화면의 상위 부서 선택으로도 할 수 있다
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain");
                    setDragging(null);
                    if (id) move(id, null);
                  }}
                  className="rounded-md border border-dashed p-2 text-center text-sm text-muted-foreground"
                >
                  여기에 놓으면 최상위로 이동합니다
                </div>
              )}
              {tree.length === 0 ? (
                <p className="text-muted-foreground">부서가 없습니다. 최상위 부서를 추가하세요.</p>
              ) : (
                <ul className="space-y-1">
                  {tree.map((n) => (
                    <Row
                      key={n.id}
                      node={n}
                      maxDepth={chart.maxDeptDepth}
                      dragging={dragging}
                      setDragging={setDragging}
                      onMove={move}
                      onPanel={setPanel}
                      onChanged={refresh}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

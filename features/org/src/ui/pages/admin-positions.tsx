"use client";

import { api, errorMessage } from "@fmerp/shared/lib/api";
import type { MasterItem } from "@fmerp/shared/lib/types";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { DataTable, type DataTableColumn } from "@fmerp/shared/ui/data-table";
import { EmptyState } from "@fmerp/shared/ui/empty-state";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import { LoadingState } from "@fmerp/shared/ui/loading-state";
import { PageHeader } from "@fmerp/shared/ui/page-header";
import { QueryErrorState } from "@fmerp/shared/ui/query-error-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@fmerp/shared/ui/tabs";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { useDuties, usePositions } from "../queries";

/** 직위(서열 있음)·직책 마스터 한 종류의 추가 폼과 목록 */
function MasterTab({
  kind,
  title,
  description,
  items,
}: {
  kind: "positions" | "duties";
  title: string;
  description: string;
  items: MasterItem[];
}) {
  const queryClient = useQueryClient();
  const withRank = kind === "positions";
  const [name, setName] = useState("");
  const [rank, setRank] = useState("");

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: [kind] });
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/api/${kind}`, {
        method: "POST",
        body: withRank ? { name, rank: Number(rank) } : { name },
      });
      setName("");
      setRank("");
      await refresh();
      toast.success(`${title}을(를) 추가했습니다`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function toggle(item: MasterItem) {
    try {
      await api(`/api/${kind}/${item.id}`, { method: "PATCH", body: { active: !item.active } });
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function changeRank(item: MasterItem, value: string) {
    if (value === "" || Number(value) === item.rank) return;
    try {
      await api(`/api/${kind}/${item.id}`, { method: "PATCH", body: { rank: Number(value) } });
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const columns: DataTableColumn<MasterItem>[] = [
    {
      id: "name",
      header: "이름",
      sortValue: (m) => m.name,
      cell: (m) => <div className="font-medium">{m.name}</div>,
    },
    ...(withRank
      ? [
          {
            id: "rank",
            header: "서열 (클수록 상위)",
            sortValue: (m: MasterItem) => m.rank ?? 0,
            cell: (m: MasterItem) => (
              <Input
                aria-label={`${m.name} 서열`}
                type="number"
                min={0}
                defaultValue={m.rank}
                className="h-8 w-24"
                onBlur={(e) => changeRank(m, e.target.value)}
              />
            ),
          },
        ]
      : []),
    {
      id: "status",
      header: "상태",
      sortValue: (m) => (m.active ? "사용" : "사용 안 함"),
      cell: (m) => (
        <Badge variant={m.active ? "success" : "outline"}>{m.active ? "사용" : "사용 안 함"}</Badge>
      ),
    },
    {
      id: "actions",
      header: "작업",
      align: "right",
      cell: (m) => (
        <Button
          size="sm"
          variant="outline"
          aria-label={`${m.name} ${m.active ? "사용 안 함" : "사용"}`}
          onClick={() => toggle(m)}
        >
          {m.active ? "사용 안 함" : "사용"}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title} 추가</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor={`${kind}-name`}>이름</Label>
              <Input
                id={`${kind}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                required
              />
            </div>
            {withRank && (
              <div className="w-28 space-y-2">
                <Label htmlFor={`${kind}-rank`}>서열</Label>
                <Input
                  id={`${kind}-rank`}
                  type="number"
                  min={0}
                  value={rank}
                  onChange={(e) => setRank(e.target.value)}
                  required
                />
              </div>
            )}
            <Button type="submit">추가</Button>
          </form>
        </CardContent>
      </Card>

      <DataTable
        rows={items}
        columns={columns}
        rowKey={(m) => m.id}
        caption={`${title} 목록`}
        search={{
          placeholder: `${title} 이름 검색`,
          text: (m) => m.name,
        }}
        filters={[
          {
            id: "status",
            label: "상태",
            allLabel: "전체 상태",
            options: [
              { value: "active", label: "사용" },
              { value: "inactive", label: "사용 안 함" },
            ],
            predicate: (m, v) => (v === "active" ? m.active : !m.active),
          },
        ]}
        empty={<EmptyState title="등록된 항목이 없습니다." />}
      />
    </div>
  );
}

/** 직위·직책 마스터 관리 (PRD ORG-030·031). 구성원 관리와 같은 제목·탭·표 구성 */
export default function PositionsPage() {
  const {
    data: positions,
    isLoading: positionsLoading,
    isError: positionsError,
    refetch: refetchPositions,
  } = usePositions();
  const {
    data: duties,
    isLoading: dutiesLoading,
    isError: dutiesError,
    refetch: refetchDuties,
  } = useDuties();
  if (positionsError) return <QueryErrorState onRetry={() => void refetchPositions()} />;
  if (dutiesError) return <QueryErrorState onRetry={() => void refetchDuties()} />;
  if (positionsLoading || dutiesLoading || !positions || !duties) return <LoadingState />;
  return (
    <div>
      <PageHeader title="직위·직책" breadcrumbs={[{ label: "관리" }, { label: "직위·직책" }]} />
      <Tabs defaultValue="positions" className="gap-4">
        <TabsList variant="line">
          <TabsTrigger value="positions">직위</TabsTrigger>
          <TabsTrigger value="duties">직책</TabsTrigger>
        </TabsList>
        <TabsContent value="positions">
          <MasterTab
            kind="positions"
            title="직위"
            description="서열이 클수록 상위입니다. 사용 중인 직위는 삭제하지 않고 사용 안 함으로 바꿉니다."
            items={positions}
          />
        </TabsContent>
        <TabsContent value="duties">
          <MasterTab
            kind="duties"
            title="직책"
            description="팀장·본부장 등. 부서장 지정과 함께 씁니다."
            items={duties}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

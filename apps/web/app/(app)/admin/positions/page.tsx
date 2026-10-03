"use client";

import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { useDuties, usePositions } from "@/lib/queries";
import type { MasterItem } from "@/lib/types";

/** 직위(서열 있음)·직책 마스터 한 종류의 목록과 추가 폼 */
function MasterSection({
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                {withRank && <TableHead className="w-32">서열 (클수록 상위)</TableHead>}
                <TableHead>상태</TableHead>
                <TableHead className="text-right">작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.name}</TableCell>
                  {withRank && (
                    <TableCell>
                      <Input
                        aria-label={`${item.name} 서열`}
                        type="number"
                        min={0}
                        defaultValue={item.rank}
                        className="h-8 w-24"
                        onBlur={(e) => changeRank(item, e.target.value)}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <Badge variant={item.active ? "secondary" : "outline"}>
                      {item.active ? "사용" : "사용 안 함"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => toggle(item)}>
                      {item.active ? "사용 안 함" : "사용"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={withRank ? 4 : 3} className="text-muted-foreground">
                    등록된 항목이 없습니다.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/** 직위·직책 마스터 관리 (PRD ORG-030·031) */
export default function PositionsPage() {
  const { data: positions } = usePositions();
  const { data: duties } = useDuties();
  if (!positions || !duties) return null;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">직위·직책</h1>
      <MasterSection
        kind="positions"
        title="직위"
        description="서열이 클수록 상위입니다. 사용 중인 직위는 삭제하지 않고 사용 안 함으로 바꿉니다."
        items={positions}
      />
      <MasterSection
        kind="duties"
        title="직책"
        description="팀장·본부장 등. 부서장 지정과 함께 씁니다."
        items={duties}
      />
    </div>
  );
}

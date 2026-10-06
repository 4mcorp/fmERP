"use client";

import { useMembers } from "@fmerp/shared/lib/queries";
import type { Member } from "@fmerp/shared/lib/types";
import { Badge } from "@fmerp/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@fmerp/shared/ui/tabs";
import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { buildDeptTree, type DeptTreeNode, filterDeptTree, totalMembers } from "../org-tree";
import { useOrgChart } from "../queries";

function MemberLine({ member, departmentId }: { member: Member; departmentId: string }) {
  const a = member.assignments.find((x) => x.departmentId === departmentId);
  return (
    <li className="flex flex-wrap items-center gap-x-2 text-sm">
      <span className="font-medium">{member.name}</span>
      <span className="text-muted-foreground">
        {[a?.positionName, a?.dutyName].filter(Boolean).join(" · ") || "직위 미지정"}
      </span>
      {a && !a.isPrimary && <Badge variant="outline">겸직</Badge>}
      {member.status !== "active" && <Badge variant="outline">비활성</Badge>}
    </li>
  );
}

function TreeNode({ node, members }: { node: DeptTreeNode; members: Member[] }) {
  const [open, setOpen] = useState(node.depth === 1);
  const here = members.filter((m) => m.assignments.some((a) => a.departmentId === node.id));
  const hasContent = node.children.length > 0 || here.length > 0;
  return (
    <li>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={!hasContent}
          aria-expanded={hasContent ? open : undefined}
          aria-label={`${node.name} ${open ? "접기" : "펼치기"}`}
          className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-muted disabled:opacity-30"
        >
          <ChevronRight
            className={`size-4 transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          />
        </button>
        <span className="font-medium">{node.name}</span>
        <span className="text-xs text-muted-foreground">{node.code}</span>
        {!node.active && <Badge variant="outline">폐지</Badge>}
        <Badge variant="secondary" aria-label={`구성원 ${totalMembers(node)}명`}>
          {totalMembers(node)}명
        </Badge>
        {node.headName && (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            부서장 {node.headName}
          </span>
        )}
      </div>
      {open && hasContent && (
        <div className="ml-3 border-l pl-3">
          {here.length > 0 && (
            <ul className="my-1 space-y-0.5 pl-5">
              {here.map((m) => (
                <MemberLine key={m.userId} member={m} departmentId={node.id} />
              ))}
            </ul>
          )}
          <ul className="space-y-1">
            {node.children.map((c) => (
              <TreeNode key={c.id} node={c} members={members} />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/** 조직도 차트: 부서를 상자로, 하위 부서를 오른쪽으로 펼친다 */
function ChartNode({ node }: { node: DeptTreeNode }) {
  return (
    <li className="flex items-start gap-2">
      <div
        className={`min-w-32 rounded-lg border bg-card p-2 text-center text-sm ${node.active ? "" : "opacity-60"}`}
      >
        <div className="font-medium">{node.shortName ?? node.name}</div>
        <div className="text-xs text-muted-foreground">
          {node.headName ?? "부서장 없음"} · {totalMembers(node)}명
        </div>
      </div>
      {node.children.length > 0 && (
        <ul className="space-y-2 border-l pl-2">
          {node.children.map((c) => (
            <ChartNode key={c.id} node={c} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** 조직도 조회·검색 (PRD IA 조직도, ORG-016). 전 구성원이 볼 수 있다 */
export default function OrgPage() {
  const { data: chart } = useOrgChart();
  const { data: members } = useMembers();
  const [query, setQuery] = useState("");

  const trees = useMemo(
    () =>
      chart?.businesses.map((b) => ({
        ...b,
        tree: filterDeptTree(buildDeptTree(b.departments), query),
      })) ?? [],
    [chart, query],
  );

  if (!chart) return null;
  const empty = trees.every((t) => t.tree.length === 0);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">조직도</h1>
      <div className="space-y-2">
        <Label htmlFor="org-search">부서 검색</Label>
        <div className="relative max-w-sm">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="org-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="부서명 또는 코드"
            className="pl-8"
          />
        </div>
      </div>

      <Tabs defaultValue="tree">
        <TabsList>
          <TabsTrigger value="tree">트리 보기</TabsTrigger>
          <TabsTrigger value="chart">차트 보기</TabsTrigger>
        </TabsList>
        {(["tree", "chart"] as const).map((view) => (
          <TabsContent key={view} value={view} className="space-y-4">
            {empty && (
              <p className="text-muted-foreground">
                {query ? "검색 결과가 없습니다." : "등록된 부서가 없습니다."}
              </p>
            )}
            {trees
              .filter((t) => t.tree.length > 0)
              .map((t) => (
                <Card key={t.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      {t.name}
                      {!t.active && <Badge variant="outline">비활성</Badge>}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className={view === "chart" ? "overflow-x-auto" : ""}>
                    <ul className="space-y-2">
                      {t.tree.map((n) =>
                        view === "tree" ? (
                          <TreeNode key={n.id} node={n} members={members ?? []} />
                        ) : (
                          <ChartNode key={n.id} node={n} />
                        ),
                      )}
                    </ul>
                  </CardContent>
                </Card>
              ))}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

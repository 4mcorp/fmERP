"use client";

import { api, errorMessage } from "@fmerp/shared/lib/api";
import { useDepartments, useMembers } from "@fmerp/shared/lib/queries";
import { formatDateTime, RECIPIENT_KIND_LABEL, type RecipientInfo } from "@fmerp/shared/lib/types";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { Modal } from "@fmerp/shared/ui/modal";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useRecipients } from "../queries";
import { TargetSelect, type TargetValue } from "./target-select";

/**
 * 문서 상세의 참조·수신·공람 (APV-070·072·073): 대상과 열람·접수·배부 상태, 수신 접수·배부, 완료 문서의 공람 지정.
 * 열람 일시는 기안자와 결재선 참여자에게만 온다.
 */
export function RecipientPanel({
  documentId,
  completed,
  involved,
}: {
  documentId: string;
  /** 문서가 완료됐는지 */
  completed: boolean;
  /** 보는 사람이 기안자 또는 결재선 참여자인지 (공람 지정 가능, 열람 현황 표시) */
  involved: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: recipients } = useRecipients(documentId);
  const { data: members } = useMembers();
  const { data: departments } = useDepartments();
  const [busy, setBusy] = useState(false);
  const [distribute, setDistribute] = useState<RecipientInfo | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [circulateOpen, setCirculateOpen] = useState(false);
  const [circulateTargets, setCirculateTargets] = useState<{ target: TargetValue; name: string }[]>(
    [],
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["approval-recipients", documentId] });

  async function run(task: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await task();
      toast.success(ok);
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const list = recipients ?? [];
  const canCirculate = completed && involved;
  if (list.length === 0 && !canCirculate) return null;

  const candidates = (r: RecipientInfo) =>
    (members ?? []).filter(
      (m) => m.status === "active" && m.assignments.some((a) => a.departmentId === r.targetId),
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">참조·수신·공람</CardTitle>
        <CardDescription>
          {involved
            ? "열람한 사람과 시각, 접수·배부 상태를 볼 수 있습니다."
            : "이 문서의 전달 대상입니다."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {list.length === 0 && (
          <p className="text-sm text-muted-foreground">지정된 대상이 없습니다.</p>
        )}
        <ul className="divide-y rounded-md border">
          {list.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
              <Badge variant="outline">{RECIPIENT_KIND_LABEL[r.kind]}</Badge>
              <span className="font-medium">
                {r.targetType === "department" ? "[부서] " : ""}
                {r.targetName}
              </span>
              <span className="text-muted-foreground">{statusText(r, involved)}</span>
              <span className="ml-auto flex gap-2">
                {r.canReceive && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => api(`/api/recipients/${r.id}/receive`, { method: "POST" }),
                        "접수했습니다",
                      )
                    }
                  >
                    {busy ? "처리 중…" : "접수"}
                  </Button>
                )}
                {r.canDistribute && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setPicked([]);
                      setDistribute(r);
                    }}
                  >
                    {busy ? "처리 중…" : "배부"}
                  </Button>
                )}
              </span>
              {involved && r.reads.length > 0 && (
                <ul className="w-full pl-2 text-xs text-muted-foreground">
                  {r.reads.map((x) => (
                    <li key={x.membershipId}>
                      {x.name} · {formatDateTime(x.readAt)} 열람
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        {canCirculate && (
          <Button variant="outline" size="sm" onClick={() => setCirculateOpen(true)}>
            <Plus aria-hidden />
            공람 지정
          </Button>
        )}
      </CardContent>

      <Modal
        open={distribute !== null}
        onClose={() => setDistribute(null)}
        title="부서 안 담당자에게 배부"
        description={`${distribute?.targetName ?? ""} 소속 구성원을 고르세요. 접수한 사람만 배부할 수 있습니다.`}
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!distribute || picked.length === 0) return;
            const id = distribute.id;
            setDistribute(null);
            void run(
              () =>
                api(`/api/recipients/${id}/distribute`, {
                  method: "POST",
                  body: { membershipIds: picked },
                }),
              "배부했습니다",
            );
          }}
        >
          <ul className="max-h-60 space-y-1 overflow-y-auto">
            {distribute &&
              candidates(distribute).map((m) => (
                <li key={m.membershipId}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={picked.includes(m.membershipId)}
                      onChange={(e) =>
                        setPicked((p) =>
                          e.target.checked
                            ? [...p, m.membershipId]
                            : p.filter((x) => x !== m.membershipId),
                        )
                      }
                    />
                    {m.name}
                  </label>
                </li>
              ))}
            {distribute && candidates(distribute).length === 0 && (
              <li className="text-sm text-muted-foreground">배부할 수 있는 구성원이 없습니다.</li>
            )}
          </ul>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDistribute(null)}>
              취소
            </Button>
            <Button type="submit" disabled={picked.length === 0}>
              배부
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={circulateOpen}
        onClose={() => setCirculateOpen(false)}
        title="공람 지정"
        description="완료된 문서를 사람이나 부서에게 회람합니다. 지정하면 바로 열람할 수 있습니다."
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (circulateTargets.length === 0) return;
            const targets = circulateTargets.map((t) => t.target);
            setCirculateOpen(false);
            setCirculateTargets([]);
            void run(
              () =>
                api(`/api/approvals/${documentId}/circulate`, {
                  method: "POST",
                  body: { targets },
                }),
              "공람을 지정했습니다",
            );
          }}
        >
          <TargetSelect
            id="circulate-target"
            label="공람 대상 추가"
            members={members ?? []}
            departments={departments ?? []}
            exclude={[
              ...circulateTargets.map((t) => t.target),
              ...list
                .filter((r) => r.kind === "circulate")
                .map((r) => ({ type: r.targetType, id: r.targetId })),
            ]}
            onPick={(target, name) => setCirculateTargets((t) => [...t, { target, name }])}
          />
          <ul className="flex flex-wrap gap-2">
            {circulateTargets.map((t) => (
              <li key={`${t.target.type}:${t.target.id}`}>
                <Badge variant="secondary" className="gap-1 py-1 pr-1">
                  {t.target.type === "department" ? "[부서] " : ""}
                  {t.name}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    aria-label={`${t.name} 공람 대상 삭제`}
                    onClick={() =>
                      setCirculateTargets((list) =>
                        list.filter(
                          (x) => !(x.target.type === t.target.type && x.target.id === t.target.id),
                        ),
                      )
                    }
                  >
                    <X className="size-3" aria-hidden />
                  </Button>
                </Badge>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCirculateOpen(false)}>
              취소
            </Button>
            <Button type="submit" disabled={circulateTargets.length === 0}>
              지정
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

function statusText(r: RecipientInfo, involved: boolean): string {
  if (r.kind === "receive") {
    const parts = [
      r.receivedByName
        ? `${r.receivedByName} 접수${r.receivedAt ? ` · ${formatDateTime(r.receivedAt)}` : ""}`
        : "접수 대기",
    ];
    if (r.assigneeName && !r.receivedByName) parts.push(`담당 ${r.assigneeName}`);
    if (r.distributedTo.length > 0)
      parts.push(`배부: ${r.distributedTo.map((d) => d.name).join(", ")}`);
    return parts.join(" · ");
  }
  if (!involved) return "";
  return r.reads.length > 0 ? `열람 ${r.reads.length}명` : "아직 열람하지 않음";
}

"use client";

import { api, errorMessage } from "@fmerp/shared/lib/api";
import { useDepartments, useMembers } from "@fmerp/shared/lib/queries";
import { RECIPIENT_KIND_LABEL, type RecipientInfo } from "@fmerp/shared/lib/types";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { Label } from "@fmerp/shared/ui/label";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useRecipients } from "../queries";
import { TargetSelect, type TargetValue } from "./target-select";

const GROUPS: { kind: RecipientInfo["kind"]; help: string; departmentOnly?: boolean }[] = [
  { kind: "cc", help: "결재 과정을 함께 보는 사람·부서입니다. 열람 시점은 양식 설정을 따릅니다." },
  {
    kind: "receive",
    help: "완료되면 수신 부서 문서함으로 전달됩니다. 부서장이나 지정 담당자가 접수한 뒤 부서에서 열람합니다 (대외비 이상은 접수자만).",
    departmentOnly: true,
  },
  { kind: "circulate", help: "완료된 뒤 지정한 사람·부서에게 회람합니다." },
];

interface Item {
  kind: RecipientInfo["kind"];
  target: TargetValue;
  name: string;
  assigneeMembershipId: string | null;
}

/**
 * 초안의 참조·수신·공람 지정 (APV-070·072·073). 바꿀 때마다 서버에 바로 저장한다.
 * 상신하면 DB가 막으므로 초안에서만 쓴다.
 */
export function RecipientEditor({ documentId }: { documentId: string }) {
  const queryClient = useQueryClient();
  const { data: members } = useMembers();
  const { data: departments } = useDepartments();
  const { data: recipients } = useRecipients(documentId);
  const [assignee, setAssignee] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const items: Item[] = (recipients ?? []).map((r) => ({
    kind: r.kind,
    target: { type: r.targetType, id: r.targetId },
    name: r.targetName,
    assigneeMembershipId: r.assigneeMembershipId,
  }));

  async function save(next: Item[]) {
    setSaving(true);
    try {
      await api(`/api/approvals/${documentId}/recipients`, {
        method: "PUT",
        body: {
          items: next.map((i) => ({
            kind: i.kind,
            target: i.target,
            assigneeMembershipId: i.assigneeMembershipId,
          })),
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["approval-recipients", documentId] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const add = (kind: RecipientInfo["kind"], target: TargetValue, name: string) =>
    save([
      ...items,
      {
        kind,
        target,
        name,
        assigneeMembershipId: kind === "receive" && assignee ? assignee : null,
      },
    ]);
  const remove = (index: number) => save(items.filter((_, i) => i !== index));

  return (
    <div className="space-y-5">
      {GROUPS.map((g) => {
        const mine = items
          .map((item, index) => ({ item, index }))
          .filter((x) => x.item.kind === g.kind);
        return (
          <div key={g.kind} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor={`rec-${g.kind}`} className="font-medium">
                {RECIPIENT_KIND_LABEL[g.kind]}
              </Label>
              <TargetSelect
                id={`rec-${g.kind}`}
                label={`${RECIPIENT_KIND_LABEL[g.kind]} 대상 추가`}
                members={members ?? []}
                departments={departments ?? []}
                allowMembers={!g.departmentOnly}
                exclude={mine.map((x) => x.item.target)}
                onPick={(target, name) => add(g.kind, target, name)}
              />
              {g.kind === "receive" && (
                <select
                  aria-label="접수 담당자 (선택)"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
                >
                  <option value="">접수 담당자: 부서장</option>
                  {(members ?? [])
                    .filter((m) => m.status === "active")
                    .map((m) => (
                      <option key={m.membershipId} value={m.membershipId}>
                        접수 담당자: {m.name}
                      </option>
                    ))}
                </select>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{g.help}</p>
            {mine.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {mine.map(({ item, index }) => (
                  <li key={`${item.target.type}:${item.target.id}`}>
                    <Badge variant="secondary" className="gap-1 py-1 pr-1">
                      {item.target.type === "department" ? "[부서] " : ""}
                      {item.name}
                      {item.assigneeMembershipId && (
                        <span className="text-muted-foreground">
                          · 담당{" "}
                          {members?.find((m) => m.membershipId === item.assigneeMembershipId)
                            ?.name ?? ""}
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-5"
                        onClick={() => remove(index)}
                        disabled={saving}
                        aria-label={`${item.name} ${RECIPIENT_KIND_LABEL[g.kind]} 삭제`}
                      >
                        <X className="size-3" aria-hidden />
                      </Button>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground" role="status">
        {saving ? "저장 중…" : "바꾸면 바로 저장됩니다."}
      </p>
    </div>
  );
}

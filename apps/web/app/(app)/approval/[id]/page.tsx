"use client";

import type { FormSchema } from "@fmerp/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pause, Play, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AttachmentList } from "@/components/approval/attachment-uploader";
import { FormValuesView } from "@/components/approval/form-view";
import { LineEditor, type LineRow, rowsToItems } from "@/components/approval/line-editor";
import { PinDialog } from "@/components/approval/pin-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiProblem, api, errorMessage } from "@/lib/api";
import {
  useApproval,
  useApprovalBody,
  useAttachments,
  useBusinesses,
  useCapabilities,
  useComments,
  useDepartments,
  useMe,
  useMembers,
  usePending,
} from "@/lib/queries";
import {
  type ApprovalStepView,
  DOC_STATUS_LABEL,
  type FormDefinition,
  formatDateTime,
  SECURITY_LABEL,
  STEP_STATUS_LABEL,
  STEP_TYPE_LABEL,
} from "@/lib/types";

interface DocForm {
  name: string;
  version: number;
  definition: FormDefinition;
}

type Action = { kind: string; comment?: string };

interface ActionButton {
  label: string;
  action: Action;
  icon?: "check" | "x" | "pause" | "play";
  variant?: "default" | "outline" | "destructive";
  /** 사유(의견) 입력을 받은 뒤 실행 */
  askReason?: "required" | "optional";
}

/** 단계 유형·상태별로 처리 버튼을 정한다 (APV-040) */
function buttonsFor(
  step: ApprovalStepView,
  policy: FormDefinition["policy"] | undefined,
): ActionButton[] {
  if (step.status === "HELD")
    return [{ label: "보류 해제", action: { kind: "release" }, icon: "play" }];
  if (step.status === "POST_PENDING")
    return [{ label: "후결 승인", action: { kind: "post_approve" }, icon: "check" }];
  switch (step.type) {
    case "approve":
      return [
        { label: "승인", action: { kind: "approve" }, icon: "check" },
        ...(step.canFinalize
          ? [
              {
                label: "전결",
                action: { kind: "finalize" },
                icon: "check" as const,
                variant: "outline" as const,
              },
            ]
          : []),
        {
          label: "반려",
          action: { kind: "reject" },
          icon: "x",
          variant: "destructive",
          askReason: "required",
        },
        {
          label: "보류",
          action: { kind: "hold" },
          icon: "pause",
          variant: "outline",
          askReason: "optional",
        },
      ];
    case "agree":
      return [
        { label: "동의", action: { kind: "agree" }, icon: "check" },
        {
          label: "부동의",
          action: { kind: "disagree" },
          icon: "x",
          variant: "destructive",
          askReason: "required",
        },
        {
          label: "보류",
          action: { kind: "hold" },
          icon: "pause",
          variant: "outline",
          askReason: "optional",
        },
      ];
    case "cooperate":
      return [
        { label: "동의", action: { kind: "agree" }, icon: "check" },
        {
          label: "의견 제출(부동의)",
          action: { kind: "disagree" },
          icon: "x",
          variant: "outline",
          askReason: "required",
        },
      ];
    case "audit": {
      const canReject = policy?.auditCanReject ?? true;
      return [
        ...(canReject
          ? [{ label: "감사 승인", action: { kind: "audit_approve" }, icon: "check" as const }]
          : []),
        {
          label: "의견만 남기고 진행",
          action: { kind: "audit_comment" },
          icon: "check",
          variant: canReject ? "outline" : "default",
          askReason: "required",
        },
        ...(canReject
          ? [
              {
                label: "감사 반려",
                action: { kind: "audit_reject" },
                icon: "x" as const,
                variant: "destructive" as const,
                askReason: "required" as const,
              },
            ]
          : []),
      ];
    }
    default:
      return [];
  }
}

const ICONS = { check: Check, x: X, pause: Pause, play: Play } as const;

/** 문서 상세·결재 처리: 본문, 진행 현황, 첨부, 의견, 처리(재인증), 회수·재기안, 결재선 변경 (APV-017·019·037·040~043·048). 360px 모바일에서 전 과정 가능 */
export default function ApprovalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const { data: view } = useApproval(id);
  const { data: serverBody } = useApprovalBody(id);
  const { data: attachments } = useAttachments(id);
  const { data: comments } = useComments(id);
  const { data: pending } = usePending();
  const { data: members } = useMembers();
  const { data: departments } = useDepartments();
  const { data: businesses } = useBusinesses();
  const { data: caps } = useCapabilities(Boolean(me?.activeAccountId));
  const { data: docForm } = useQuery({
    queryKey: ["approval-form", id],
    queryFn: () => api<DocForm>(`/api/approvals/${id}/form`),
    retry: false,
  });

  const [reason, setReason] = useState<{ button: ActionButton; step: ApprovalStepView } | null>(
    null,
  );
  const [reasonText, setReasonText] = useState("");
  const [pin, setPin] = useState<{ needsSetup: boolean } | null>(null);
  const retry = useRef<(() => Promise<void>) | null>(null);
  const [busy, setBusy] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentVisibility, setCommentVisibility] = useState<"all" | "drafter">("all");
  const [lineOpen, setLineOpen] = useState(false);
  const [lineRows, setLineRows] = useState<LineRow[]>([]);
  const [lineRemove, setLineRemove] = useState<string[]>([]);
  const [lineReason, setLineReason] = useState("");
  const [lineError, setLineError] = useState<string[]>([]);

  const ctx = useMemo(
    () => ({
      members: members ?? [],
      departments: departments ?? [],
      businesses: businesses ?? [],
    }),
    [members, departments, businesses],
  );
  const myMembershipId = members?.find((m) => m.userId === me?.id)?.membershipId;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["approval", id] });
    await queryClient.invalidateQueries({ queryKey: ["approval-comments", id] });
    await queryClient.invalidateQueries({ queryKey: ["inbox-pending"] });
    await queryClient.invalidateQueries({ queryKey: ["inbox-mine"] });
  }

  /** 재인증이 필요하면(428) PIN 대화상자를 띄우고, 확인되면 같은 요청을 다시 보낸다 */
  async function withReauth(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 428) {
        retry.current = task;
        setPin({ needsSetup: error.code === "pin_not_set" });
      } else {
        toast.error(errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  function act(step: ApprovalStepView, action: Action) {
    const key = crypto.randomUUID();
    return withReauth(async () => {
      await api(`/api/approvals/${id}/steps/${step.id}/act`, {
        method: "POST",
        body: { action, idempotencyKey: key, expectedVersion: step.version },
      });
      toast.success("처리했습니다");
      setReason(null);
      setReasonText("");
      await refresh();
    });
  }

  async function simple(path: string, ok: string, then?: (r: { documentId?: string }) => void) {
    setBusy(true);
    try {
      const result = await api<{ documentId?: string }>(`/api/approvals/${id}/${path}`, {
        method: "POST",
      });
      toast.success(ok);
      await refresh();
      then?.(result);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function addComment(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/api/approvals/${id}/comments`, {
        method: "POST",
        body: { body: commentText, visibility: commentVisibility },
      });
      setCommentText("");
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  if (!view || !me) return null;
  if (view.status === "DRAFT" && view.drafterMembershipId === myMembershipId) {
    router.replace(`/approval/draft/${id}`);
    return null;
  }

  const isDrafter = view.drafterMembershipId === myMembershipId;
  const flowSteps = view.steps.filter((s) => s.type !== "post");
  const untouched = flowSteps.every((s) => s.status === "PENDING" || s.status === "ACTIVE");
  const myPending = pending?.find((p) => p.documentId === id);
  const myStep = myPending ? view.steps.find((s) => s.id === myPending.stepId) : undefined;
  const myPostStep = view.steps.find(
    (s) =>
      s.status === "POST_PENDING" && s.assignees.some((a) => a.membershipId === myMembershipId),
  );
  const actionStep = myStep ?? myPostStep;
  const policy = docForm?.definition.policy;
  const canEditLine =
    Boolean(docForm?.definition.allowLineEdit) &&
    (view.status === "IN_PROGRESS" || view.status === "ON_HOLD") &&
    (Boolean(myStep) || Boolean(caps?.["approval.manage"]));
  const floor = Math.max(
    0,
    ...view.steps.filter((s) => s.type !== "post" && s.status !== "PENDING").map((s) => s.seq),
  );

  async function submitLineChange(e: FormEvent) {
    e.preventDefault();
    setLineError([]);
    const edits = [
      ...lineRemove.map((stepId) => ({ kind: "remove" as const, stepId })),
      ...rowsToItems(lineRows).map((item) => ({
        kind: "add" as const,
        item: { ...item, seq: item.seq + floor },
      })),
    ];
    await withReauth(async () => {
      try {
        await api(`/api/approvals/${id}/line`, {
          method: "PUT",
          body: { reason: lineReason, edits },
        });
      } catch (error) {
        if (error instanceof ApiProblem && error.status !== 428) {
          const list = error.extensions?.errors;
          setLineError(
            Array.isArray(list)
              ? list.map((x) =>
                  typeof x === "string" ? x : ((x as { message?: string }).message ?? ""),
                )
              : [errorMessage(error)],
          );
          return;
        }
        throw error;
      }
      toast.success("결재선을 변경했습니다");
      setLineOpen(false);
      setLineRows([]);
      setLineRemove([]);
      setLineReason("");
      await refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 break-words text-2xl font-semibold">{view.title}</h1>
          <Badge variant={view.status === "COMPLETED" ? "secondary" : "outline"}>
            {DOC_STATUS_LABEL[view.status] ?? view.status}
          </Badge>
          {view.urgent && <Badge variant="destructive">긴급</Badge>}
          {view.securityLevel !== "normal" && (
            <Badge variant="outline">{SECURITY_LABEL[view.securityLevel]}</Badge>
          )}
          {view.supersedes && (
            <Link
              href={`/approval/${view.supersedes}`}
              className="text-sm underline underline-offset-4"
            >
              원문 보기
            </Link>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {docForm?.name ?? "문서"} · {view.drafterSnapshot.name ?? ""}
          {view.drafterSnapshot.departmentName ? ` · ${view.drafterSnapshot.departmentName}` : ""}
          {view.docNo ? ` · ${view.docNo}` : ""}
          {view.submittedAt ? ` · ${formatDateTime(view.submittedAt)} 상신` : ""}
        </p>
      </div>

      {actionStep && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="text-base">
              {myPending?.asDelegate ? "대결 처리" : "결재 처리"} —{" "}
              {STEP_TYPE_LABEL[actionStep.type]}
            </CardTitle>
            <CardDescription>
              처리할 때 결재 PIN 확인이 필요합니다. 처리 후에는 되돌릴 수 없습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {buttonsFor(actionStep, policy).map((b) => {
              const Icon = b.icon ? ICONS[b.icon] : null;
              return (
                <Button
                  key={b.label}
                  type="button"
                  variant={b.variant ?? "default"}
                  disabled={busy}
                  onClick={() => {
                    if (b.askReason) {
                      setReason({ button: b, step: actionStep });
                      setReasonText("");
                    } else {
                      void act(actionStep, b.action);
                    }
                  }}
                >
                  {Icon && <Icon aria-hidden />}
                  {b.label}
                </Button>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {isDrafter && view.status === "IN_PROGRESS" && untouched && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => simple("withdraw", "회수했습니다")}
          >
            회수
          </Button>
        )}
        {isDrafter && view.status === "WITHDRAWN" && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              simple("reopen", "초안으로 되돌렸습니다", () => router.push(`/approval/draft/${id}`))
            }
          >
            수정하기(초안으로)
          </Button>
        )}
        {isDrafter && view.status === "REJECTED" && (
          <Button
            disabled={busy}
            onClick={() =>
              simple("redraft", "재기안 초안을 만들었습니다", (r) =>
                router.push(`/approval/draft/${r.documentId}`),
              )
            }
          >
            재기안
          </Button>
        )}
        {canEditLine && (
          <Button
            variant="outline"
            onClick={() => {
              setLineOpen(true);
              setLineRows([]);
              setLineRemove([]);
              setLineError([]);
            }}
          >
            결재선 변경
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">결재선</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {view.steps.map((s, i) => (
              <li
                key={s.id}
                className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm ${s.status === "ACTIVE" ? "border-primary" : ""}`}
              >
                <span className="w-6 text-muted-foreground tabular-nums">{i + 1}</span>
                <Badge variant="outline">{STEP_TYPE_LABEL[s.type]}</Badge>
                <span className="min-w-0 flex-1 break-words">
                  {s.assignees
                    .map((a) => [a.name, a.positionName].filter(Boolean).join(" "))
                    .join(" / ") || "-"}
                </span>
                <Badge
                  variant={
                    s.status === "ACTIVE"
                      ? "default"
                      : s.status === "REJECTED"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {STEP_STATUS_LABEL[s.status] ?? s.status}
                </Badge>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">내용</CardTitle>
        </CardHeader>
        <CardContent>
          {docForm && serverBody ? (
            <FormValuesView
              schema={docForm.definition.schema as FormSchema}
              values={serverBody.body}
              ctx={ctx}
            />
          ) : (
            <p className="text-sm text-muted-foreground">표시할 내용이 없습니다.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">첨부</CardTitle>
        </CardHeader>
        <CardContent>
          <AttachmentList documentId={id} items={attachments ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">의견</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(comments ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">의견이 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {comments?.map((c) => (
                <li key={c.id} className="rounded-lg border p-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{c.authorName}</span>
                    <span>{formatDateTime(c.createdAt)}</span>
                    {c.visibility === "drafter" && <Badge variant="outline">기안자만</Badge>}
                  </div>
                  <p className="mt-1 break-words whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addComment} className="space-y-2">
            <Label htmlFor="comment-body">의견 추가</Label>
            <Textarea
              id="comment-body"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              maxLength={2000}
              required
            />
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="comment-visibility" className="sr-only">
                공개 범위
              </Label>
              <Select
                value={commentVisibility}
                onValueChange={(v) => setCommentVisibility(v as "all" | "drafter")}
              >
                <SelectTrigger id="comment-visibility" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">결재선 전체에 공개</SelectItem>
                  <SelectItem value="drafter">기안자에게만</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" variant="outline">
                의견 등록
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Modal
        open={reason !== null}
        onClose={() => setReason(null)}
        title={reason ? `${reason.button.label} 사유` : ""}
        description={
          reason?.button.askReason === "required"
            ? "사유를 입력해야 처리됩니다."
            : "의견은 선택입니다."
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason) void act(reason.step, { ...reason.button.action, comment: reasonText });
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label htmlFor="reason-text">사유·의견</Label>
            <Textarea
              id="reason-text"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              required={reason?.button.askReason === "required"}
              maxLength={2000}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setReason(null)}>
              취소
            </Button>
            <Button
              type="submit"
              variant={reason?.button.variant === "destructive" ? "destructive" : "default"}
              disabled={busy}
            >
              {reason?.button.label}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={lineOpen}
        onClose={() => setLineOpen(false)}
        title="결재선 변경"
        description="처리 전인 이후 단계만 추가·삭제할 수 있습니다. 사유는 감사 로그에 남습니다."
        className="w-[min(48rem,calc(100vw-2rem))]"
      >
        <form onSubmit={submitLineChange} className="space-y-4">
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">삭제할 단계 (처리 전)</legend>
            {view.steps.filter((s) => s.status === "PENDING" && s.type !== "post").length === 0 && (
              <p className="text-sm text-muted-foreground">삭제할 수 있는 단계가 없습니다.</p>
            )}
            {view.steps
              .filter((s) => s.status === "PENDING" && s.type !== "post")
              .map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={lineRemove.includes(s.id)}
                    onChange={(e) =>
                      setLineRemove((r) =>
                        e.target.checked ? [...r, s.id] : r.filter((x) => x !== s.id),
                      )
                    }
                  />
                  {STEP_TYPE_LABEL[s.type]} — {s.assignees.map((a) => a.name).join(", ")}
                </label>
              ))}
          </fieldset>
          <div className="space-y-1">
            <p className="text-sm font-medium">추가할 단계</p>
            <LineEditor rows={lineRows} onChange={setLineRows} ctx={ctx} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="line-reason">변경 사유</Label>
            <Textarea
              id="line-reason"
              value={lineReason}
              onChange={(e) => setLineReason(e.target.value)}
              required
              maxLength={500}
            />
          </div>
          {lineError.length > 0 && (
            <Alert variant="destructive">
              <AlertTitle>결재선을 변경할 수 없습니다</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {lineError.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setLineOpen(false)}>
              취소
            </Button>
            <Button
              type="submit"
              disabled={busy || (lineRows.length === 0 && lineRemove.length === 0)}
            >
              변경
            </Button>
          </div>
        </form>
      </Modal>

      <PinDialog
        open={pin !== null}
        needsSetup={pin?.needsSetup ?? false}
        onClose={() => setPin(null)}
        onVerified={() => {
          setPin(null);
          const task = retry.current;
          retry.current = null;
          if (task) void withReauth(task);
        }}
      />
    </div>
  );
}

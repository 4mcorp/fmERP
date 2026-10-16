"use client";

import type { FormSchema } from "@fmerp/shared/domain/form-schema";
import { validateFormValues } from "@fmerp/shared/domain/form-values";
import { ApiProblem, api, errorMessage } from "@fmerp/shared/lib/api";
import {
  useBusinesses,
  useCurrentAccount,
  useDepartments,
  useMe,
  useMembers,
} from "@fmerp/shared/lib/queries";
import { type FormDefinition, SECURITY_LABEL, type SecurityLevel } from "@fmerp/shared/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@fmerp/shared/ui/alert";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { AttachmentUploader } from "../components/attachment-uploader";
import { FormFields, type Values } from "../components/form-fields";
import {
  itemsToRows,
  LineEditor,
  LinePreview,
  type LineRow,
  rowsToItems,
} from "../components/line-editor";
import { RecipientEditor } from "../components/recipient-editor";
import { loadLocalDraft, removeLocalDraft, saveLocalDraft } from "../local-drafts";
import { useApproval, useApprovalBody, useApprovalPolicy, useAttachments } from "../queries";

const AUTOSAVE_MS = 30_000;
const LOCAL_SAVE_MS = 1_000;

interface DocForm {
  formId: string;
  code: string;
  name: string;
  version: number;
  definition: FormDefinition;
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "failed"; message: string };

const clock = new Intl.DateTimeFormat("ko-KR", { timeStyle: "medium", timeZone: "Asia/Seoul" });

/** 기안 작성: 본문·첨부·결재선 편집, 30초 자동 저장, 브라우저 로컬 사본과 복구, 상신 (APV-011~017, BAK-001) */
export default function DraftEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const { data: account } = useCurrentAccount(Boolean(me?.activeAccountId));
  const { data: view } = useApproval(id);
  const { data: serverBody } = useApprovalBody(id);
  const { data: attachments } = useAttachments(id);
  const { data: policy } = useApprovalPolicy();
  const { data: members } = useMembers();
  const { data: departments } = useDepartments();
  const { data: businesses } = useBusinesses();
  const { data: docForm } = useQuery({
    queryKey: ["approval-form", id],
    queryFn: () => api<DocForm>(`/api/approvals/${id}/form`),
  });

  const form = useForm<Values>({ defaultValues: {} });
  const [title, setTitle] = useState("");
  const [security, setSecurity] = useState<SecurityLevel>("normal");
  const [urgent, setUrgent] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [conflict, setConflict] = useState(false);
  const [restore, setRestore] = useState<{ values: Values; title: string } | null>(null);
  const [lineRows, setLineRows] = useState<LineRow[]>([]);
  const [lineErrors, setLineErrors] = useState<string[]>([]);
  const [lineDirty, setLineDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const initialized = useRef(false);
  const dirty = useRef(false);
  const revision = useRef(0);
  const metaRef = useRef({
    title: "",
    security: "normal" as SecurityLevel,
    urgent: false,
    dueDate: "",
  });
  metaRef.current = { title, security, urgent, dueDate };

  const schema = docForm?.definition.schema as FormSchema | undefined;
  const ctx = useMemo(
    () => ({
      members: members ?? [],
      departments: departments ?? [],
      businesses: businesses ?? [],
    }),
    [members, departments, businesses],
  );

  // 문서가 초안이 아니면 상세 화면으로 보낸다
  useEffect(() => {
    if (view && view.status !== "DRAFT") router.replace(`/approval/${id}`);
  }, [view, id, router]);

  // 초기화: 서버 본문을 읽어 폼에 넣고, 로컬 사본이 더 최신이면 복구 여부를 묻는다 (APV-011)
  useEffect(() => {
    if (initialized.current || !view || !serverBody || !docForm || !me?.activeAccountId) return;
    initialized.current = true;
    revision.current = view.latestRevision;
    setTitle(view.title);
    setSecurity(view.securityLevel);
    setUrgent(view.urgent);
    setDueDate(view.desiredDueDate ?? "");
    form.reset(serverBody.body as Values);
    setLineRows(
      itemsToRows(
        view.steps.map((s) => ({
          type: s.type,
          seq: s.seq,
          target: { kind: "user" as const, membershipId: s.assignees[0]?.membershipId ?? "" },
        })),
      ),
    );
    void loadLocalDraft(me.id, me.activeAccountId, id).then((local) => {
      if (!local) return;
      const same =
        JSON.stringify(local.values) === JSON.stringify(serverBody.body) &&
        local.title === view.title;
      if (local.baseRevision < view.latestRevision || same) {
        void removeLocalDraft(me.id, me.activeAccountId as string, id);
        return;
      }
      setRestore({ values: local.values as Values, title: local.title });
    });
  }, [view, serverBody, docForm, me, id, form]);

  const saveServer = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!initialized.current) return false;
      setSaveState({ kind: "saving" });
      try {
        const m = metaRef.current;
        const result = await api<{ revision: number }>(`/api/approvals/${id}/draft`, {
          method: "PUT",
          body: {
            title: m.title || undefined,
            body: form.getValues(),
            securityLevel: m.security,
            urgent: m.urgent,
            desiredDueDate: m.dueDate || null,
            expectedRevision: revision.current,
          },
        });
        revision.current = result.revision;
        dirty.current = false;
        setSaveState({ kind: "saved", at: new Date() });
        setConflict(false);
        await queryClient.invalidateQueries({ queryKey: ["approval", id] });
        return true;
      } catch (error) {
        if (error instanceof ApiProblem && error.code === "revision_conflict") setConflict(true);
        setSaveState({ kind: "failed", message: errorMessage(error) });
        if (!opts.silent) toast.error(errorMessage(error));
        return false;
      }
    },
    [id, form, queryClient],
  );

  // 입력이 바뀌면 1초 뒤 브라우저(IndexedDB)에 사본을 남기고, 30초마다 서버에 자동 저장한다
  useEffect(() => {
    if (!me?.activeAccountId) return;
    const accountId = me.activeAccountId;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sub = form.watch(() => {
      if (!initialized.current) return;
      dirty.current = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void saveLocalDraft({
          userId: me.id,
          accountId,
          documentId: id,
          title: metaRef.current.title,
          values: form.getValues(),
          baseRevision: revision.current,
        });
      }, LOCAL_SAVE_MS);
    });
    const interval = setInterval(() => {
      if (dirty.current) void saveServer({ silent: true });
    }, AUTOSAVE_MS);
    return () => {
      sub.unsubscribe();
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [me, id, form, saveServer]);

  function markMeta<T>(set: (v: T) => void) {
    return (v: T) => {
      dirty.current = true;
      set(v);
    };
  }

  async function saveLine() {
    setLineErrors([]);
    try {
      await api(`/api/approvals/${id}/draft-line`, {
        method: "PUT",
        body: { line: rowsToItems(lineRows) },
      });
      await queryClient.invalidateQueries({ queryKey: ["approval", id] });
      setLineDirty(false);
      toast.success("결재선을 저장했습니다");
    } catch (error) {
      const list = error instanceof ApiProblem ? error.extensions?.errors : undefined;
      setLineErrors(
        Array.isArray(list)
          ? list.map((e) =>
              typeof e === "string" ? e : ((e as { message?: string }).message ?? ""),
            )
          : [errorMessage(error)],
      );
    }
  }

  async function submit() {
    if (!schema || !me?.activeAccountId) return;
    setErrors({});
    const ok = await saveServer();
    if (!ok) return;
    const result = validateFormValues(schema, form.getValues(), {
      attachmentCount: attachments?.length ?? 0,
    });
    if (!result.ok) {
      setErrors(Object.fromEntries(result.errors.map((e) => [e.field, e.message])));
      toast.error("입력값을 확인하세요");
      return;
    }
    setSubmitting(true);
    try {
      await api(`/api/approvals/${id}/submit`, { method: "POST" });
      await removeLocalDraft(me.id, me.activeAccountId, id);
      await queryClient.invalidateQueries();
      toast.success("상신했습니다");
      router.push(`/approval/${id}`);
    } catch (error) {
      if (error instanceof ApiProblem && Array.isArray(error.extensions?.errors)) {
        const list = error.extensions.errors as { field?: string; message?: string }[];
        setErrors(
          Object.fromEntries(
            list.filter((e) => e.field).map((e) => [e.field as string, e.message ?? ""]),
          ),
        );
      }
      toast.error(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (!view || !docForm || !schema || !me) return null;
  const allowLineEdit = docForm.definition.allowLineEdit;
  const hasAttachmentField = schema.fields.some((f) => f.type === "attachment");

  return (
    <div className="w-full min-w-0 space-y-4">
      <PageHeader
        title={`${docForm.name} 작성`}
        actions={
          <>
            <Badge variant="outline">임시저장</Badge>
            <span role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {saveState.kind === "saving" && "저장 중…"}
              {saveState.kind === "saved" && `저장됨 ${clock.format(saveState.at)}`}
              {saveState.kind === "failed" &&
                "저장하지 못했습니다. 입력은 이 브라우저에 보관됩니다."}
            </span>
          </>
        }
      />

      {restore && (
        <Alert>
          <AlertTitle>저장하지 않은 입력이 있습니다</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>이 브라우저에 보관된 더 최근 입력을 불러올까요?</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  form.reset(restore.values);
                  setTitle(restore.title);
                  dirty.current = true;
                  setRestore(null);
                }}
              >
                복구
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (me.activeAccountId) void removeLocalDraft(me.id, me.activeAccountId, id);
                  setRestore(null);
                }}
              >
                버리기
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {conflict && (
        <Alert variant="destructive">
          <AlertTitle>다른 곳에서 먼저 저장되었습니다</AlertTitle>
          <AlertDescription>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              새로고침
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">기본 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="doc-title">제목</Label>
            <Input
              id="doc-title"
              value={title}
              onChange={(e) => markMeta(setTitle)(e.target.value)}
              maxLength={200}
              required
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="doc-security">보안 등급</Label>
            <Select
              value={security}
              onValueChange={(v) => markMeta(setSecurity)(v as SecurityLevel)}
            >
              <SelectTrigger id="doc-security" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SECURITY_LABEL) as SecurityLevel[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {SECURITY_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="doc-due">희망 완료일</Label>
            <Input
              id="doc-due"
              type="date"
              value={dueDate}
              onChange={(e) => markMeta(setDueDate)(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={urgent}
              onChange={(e) => markMeta(setUrgent)(e.target.checked)}
            />
            긴급 문서
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">내용</CardTitle>
          <CardDescription>
            {docForm.name} v{docForm.version} · 표시된 항목(*)은 필수입니다. 입력은 30초마다 자동
            저장됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormFields
            schema={schema}
            form={form}
            errors={errors}
            ctx={ctx}
            attachmentSlot={hasAttachmentField ? <AttachmentUploader documentId={id} /> : undefined}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">결재선</CardTitle>
          <CardDescription>
            {allowLineEdit
              ? "부서 대상 단계는 편집하면 사용자 지정으로 바뀝니다."
              : "이 양식은 결재선을 바꿀 수 없습니다."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {allowLineEdit ? (
            <>
              <LineEditor
                rows={lineRows}
                onChange={(r) => {
                  setLineRows(r);
                  setLineDirty(true);
                }}
                ctx={ctx}
                maxCells={policy?.approvalLineMaxCells}
                allowPost={docForm.definition.defaultLine.some((i) => i.type === "post")}
              />
              {lineErrors.length > 0 && (
                <Alert variant="destructive">
                  <AlertTitle>결재선을 저장할 수 없습니다</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-5">
                      {lineErrors.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              <Button type="button" variant="outline" onClick={saveLine} disabled={!lineDirty}>
                결재선 저장
              </Button>
            </>
          ) : (
            <LinePreview rows={lineRows} ctx={ctx} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">참조·수신·공람</CardTitle>
          <CardDescription>
            선택 사항입니다. 상신하면 바꿀 수 없습니다(공람은 완료 뒤에도 추가할 수 있습니다).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RecipientEditor documentId={id} />
        </CardContent>
      </Card>

      <div className="sticky bottom-0 flex flex-wrap gap-2 border-t bg-background py-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => saveServer()}
          disabled={saveState.kind === "saving"}
        >
          임시저장
        </Button>
        <Button type="button" onClick={submit} disabled={submitting || lineDirty}>
          {submitting ? "상신 중…" : "상신"}
        </Button>
        {lineDirty && (
          <span className="self-center text-sm text-muted-foreground">
            결재선을 먼저 저장하세요.
          </span>
        )}
        {account && (
          <span className="ml-auto self-center text-xs text-muted-foreground">{account.name}</span>
        )}
      </div>
    </div>
  );
}

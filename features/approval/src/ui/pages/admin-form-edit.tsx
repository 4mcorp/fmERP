"use client";

import { type FormLayout, validateFormLayout } from "@fmerp/shared/domain/form-layout";
import { validateFormSchema } from "@fmerp/shared/domain/form-schema";
import { ApiProblem, api, errorMessage } from "@fmerp/shared/lib/api";
import { useBusinesses, useDepartments, useMembers } from "@fmerp/shared/lib/queries";
import type { FormDefinition, SecurityLevel } from "@fmerp/shared/lib/types";
import { SECURITY_LABEL } from "@fmerp/shared/lib/types";
import { ActionBar } from "@fmerp/shared/ui/action-bar";
import { Alert, AlertDescription, AlertTitle } from "@fmerp/shared/ui/alert";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import { LoadingState } from "@fmerp/shared/ui/loading-state";
import { QueryErrorState } from "@fmerp/shared/ui/query-error-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@fmerp/shared/ui/select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ApprovalPageLayout } from "../components/approval-page-layout";
import { FormBlockEditor } from "../components/form-block-editor";
import { itemsToRows, LineEditor, type LineRow, rowsToItems } from "../components/line-editor";
import { type FormDraft, useFormDraftAutosave } from "../form-draft-autosave";
import { useApprovalPolicy, useFormDetail } from "../queries";

const DEFAULT_DEF: FormDefinition = {
  schema: { fields: [{ key: "body", label: "내용", type: "richtext", required: true }] },
  defaultLine: [{ type: "approve", seq: 1, target: { kind: "drafter_head", levels: 1 } }],
  numbering: { rule: "{사업자코드}-{양식코드}-{YYYY}-{SEQ:4}", cycle: "year", at: "complete" },
  retentionYears: 3,
  securityDefault: "normal",
  allowLineEdit: true,
  policy: { disagree: "reject", rejectTo: "drafter", auditCanReject: true },
};

/** 양식 블록 편집·속성·결재선·문서번호·보존연한. 저장하면 새 버전이 된다 (APV-001·004~007, ADM-004) */
export default function FormBuilderPage() {
  const { id } = useParams<{ id: string }>();
  return <FormBuilder key={id} id={id} />;
}

function FormBuilder({ id }: { id: string }) {
  const isNew = id === "new";
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    data: detail,
    isError: detailError,
    refetch: refetchDetail,
  } = useFormDetail(isNew ? undefined : id);
  const draftQuery = useQuery({
    queryKey: ["form-draft", id],
    queryFn: () => api<{ draft: FormDraft | null }>(`/api/forms/${id}/draft`),
    enabled: !isNew,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    staleTime: 0,
  });
  const { data: policy } = useApprovalPolicy();
  const { data: members } = useMembers();
  const { data: departments } = useDepartments();
  const { data: businesses } = useBusinesses();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("일반");
  const [def, setDef] = useState<FormDefinition>(DEFAULT_DEF);
  const [rows, setRows] = useState<LineRow[]>(() => itemsToRows(DEFAULT_DEF.defaultLine));
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(isNew);

  useEffect(() => {
    if (!detail || loaded || !draftQuery.data || draftQuery.isFetching) return;
    setCode(detail.code);
    setName(detail.name);
    setCategory(detail.category);
    const draft = draftQuery.data.draft;
    setDef(
      draft
        ? { ...detail.definition, schema: draft.schema, layout: { ...draft.layout } }
        : detail.definition,
    );
    setRows(itemsToRows(detail.definition.defaultLine));
    setLoaded(true);
  }, [detail, loaded, draftQuery.data, draftQuery.isFetching]);

  const ctx = useMemo(
    () => ({
      members: members ?? [],
      departments: departments ?? [],
      businesses: businesses ?? [],
    }),
    [members, departments, businesses],
  );

  const schemaCheck = validateFormSchema(def.schema);
  const layoutCheck = validateFormLayout(def.schema, def.layout ?? {});
  const draftValue = useMemo(
    () => (loaded ? { schema: def.schema, layout: (def.layout ?? {}) as FormLayout } : null),
    [loaded, def.schema, def.layout],
  );
  const autosave = useFormDraftAutosave(
    isNew ? undefined : id,
    draftValue,
    draftQuery.data?.draft?.revision ?? 0,
    schemaCheck.ok && layoutCheck.ok,
  );

  async function save(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    setSaving(true);
    try {
      await autosave.flush();
      const version = { ...def, defaultLine: rowsToItems(rows) };
      if (isNew) {
        const created = await api<{ formId: string }>("/api/forms", {
          method: "POST",
          body: { code, name, category, version },
        });
        toast.success("양식을 만들었습니다");
        await queryClient.invalidateQueries({ queryKey: ["forms"] });
        router.replace(`/admin/forms/${created.formId}`);
      } else {
        const result = await api<{ version: number }>(`/api/forms/${id}/versions`, {
          method: "POST",
          body: { version, name, category },
        });
        toast.success(
          `새 버전(v${result.version})으로 저장했습니다. 이미 작성된 문서는 이전 버전을 따릅니다`,
        );
        await queryClient.invalidateQueries({ queryKey: ["forms"] });
        await queryClient.invalidateQueries({ queryKey: ["form", id] });
      }
    } catch (error) {
      const list = error instanceof ApiProblem ? error.extensions?.errors : undefined;
      setErrors(Array.isArray(list) ? list.map(String) : [errorMessage(error)]);
    } finally {
      setSaving(false);
    }
  }

  if (draftQuery.isError && !loaded)
    return <QueryErrorState onRetry={() => draftQuery.refetch()} />;
  if (detailError && !loaded) return <QueryErrorState onRetry={() => refetchDetail()} />;
  if (!loaded) return <LoadingState />;

  return (
    <form onSubmit={save} className="space-y-4">
      <ApprovalPageLayout
        title={isNew ? "새 양식" : `${name} 편집${detail ? ` (현재 v${detail.version})` : ""}`}
      >
        <section className="flex min-w-0 flex-col gap-3" aria-label="블록 양식 편집">
          <p role="status">
            {isNew
              ? "양식을 만든 뒤부터 구조 초안을 자동 저장합니다"
              : autosave.status.kind === "saved"
                ? "초안 저장 완료"
                : autosave.status.kind === "saving"
                  ? "초안 저장 중…"
                  : autosave.status.kind === "pending"
                    ? "초안 저장 대기"
                    : "message" in autosave.status
                      ? autosave.status.message
                      : "초안 저장 완료"}
          </p>
          <p>
            자동 저장은 본문 구조만 보관합니다. 이름·결재선·속성은 새 버전으로 저장해야 반영됩니다.
          </p>
          {autosave.status.kind === "conflict" || autosave.status.kind === "error" ? (
            <Alert variant="destructive">
              <AlertTitle>초안을 저장하지 못했습니다</AlertTitle>
              <AlertDescription>
                {autosave.status.message} 현재 내용은 아래 JSON에서 복사할 수 있습니다.
                <textarea
                  aria-label="현재 초안 사본"
                  readOnly
                  value={JSON.stringify(draftValue, null, 2)}
                  className="h-32 w-full"
                />
                {autosave.status.kind === "error" ? (
                  <Button type="button" onClick={autosave.retry}>
                    초안 저장 재시도
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (
                      window.confirm(
                        "현재 내용을 복사했나요? 다시 불러오면 저장되지 않은 변경을 잃습니다.",
                      )
                    )
                      window.location.reload();
                  }}
                >
                  초안 다시 불러오기
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {[...new Set([...layoutCheck.warnings, ...autosave.status.warnings])].map((warning) => (
            <p key={warning} role="note">
              {warning}
            </p>
          ))}
          {!schemaCheck.ok || !layoutCheck.ok ? (
            <Alert variant="destructive">
              <AlertTitle>구조를 확인하세요</AlertTitle>
              <AlertDescription>
                {[
                  ...(!schemaCheck.ok ? schemaCheck.errors : []),
                  ...(!layoutCheck.ok ? layoutCheck.errors : []),
                ].join(" / ")}
              </AlertDescription>
            </Alert>
          ) : null}
          <fieldset disabled={saving} className="min-w-0">
            <FormBlockEditor
              schema={def.schema}
              layout={(def.layout ?? {}) as FormLayout}
              name={name}
              disabled={saving}
              onChange={(value) =>
                setDef((d) => ({ ...d, schema: value.schema, layout: { ...value.layout } }))
              }
            />
          </fieldset>
        </section>
        <div className="min-w-0">
          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">기본 정보</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="form-name">양식 이름</Label>
                  <Input
                    id="form-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={100}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="form-code">양식 코드 (문서번호용)</Label>
                  <Input
                    id="form-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    disabled={!isNew}
                    pattern="[A-Za-z0-9_\-]{1,30}"
                    title="영문·숫자·-·_ 30자 이하"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="form-category">분류</Label>
                  <Input
                    id="form-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    required
                    maxLength={50}
                  />
                </div>
                {isNew ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="form-orientation">용지 방향</Label>
                    <Select
                      value={def.layout?.orientation === "landscape" ? "landscape" : "portrait"}
                      onValueChange={(orientation) =>
                        setDef((d) => ({ ...d, layout: { ...d.layout, orientation } }))
                      }
                    >
                      <SelectTrigger id="form-orientation">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="portrait">A4 세로</SelectItem>
                        <SelectItem value="landscape">A4 가로</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="form-approval-position">결재란 위치</Label>
                  <Select
                    value={
                      typeof def.layout?.approvalBoxPosition === "string"
                        ? def.layout.approvalBoxPosition
                        : "top-right"
                    }
                    onValueChange={(approvalBoxPosition) =>
                      setDef((d) => ({ ...d, layout: { ...d.layout, approvalBoxPosition } }))
                    }
                  >
                    <SelectTrigger id="form-approval-position">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="top-right">오른쪽 위</SelectItem>
                      <SelectItem value="top-left">왼쪽 위</SelectItem>
                      <SelectItem value="bottom">본문 아래</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">속성</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="form-retention">보존연한</Label>
                  <Select
                    value={String(def.retentionYears)}
                    onValueChange={(v) =>
                      setDef({
                        ...def,
                        retentionYears: Number(v) as FormDefinition["retentionYears"],
                      })
                    }
                  >
                    <SelectTrigger id="form-retention" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 3, 5, 10].map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}년
                        </SelectItem>
                      ))}
                      <SelectItem value="0">영구</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="form-security">보안 등급 기본값</Label>
                  <Select
                    value={def.securityDefault}
                    onValueChange={(v) => setDef({ ...def, securityDefault: v as SecurityLevel })}
                  >
                    <SelectTrigger id="form-security" className="w-full">
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
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={def.allowLineEdit}
                    onChange={(e) => setDef({ ...def, allowLineEdit: e.target.checked })}
                  />
                  기안자·결재자가 결재선을 바꿀 수 있다
                </label>
                <div className="space-y-2">
                  <Label htmlFor="form-disagree">합의 부동의</Label>
                  <Select
                    value={def.policy.disagree}
                    onValueChange={(v) =>
                      setDef({
                        ...def,
                        policy: { ...def.policy, disagree: v as "reject" | "comment" },
                      })
                    }
                  >
                    <SelectTrigger id="form-disagree" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reject">반려로 처리</SelectItem>
                      <SelectItem value="comment">의견만 남기고 진행</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="form-rejectto">반려 대상</Label>
                  <Select
                    value={def.policy.rejectTo}
                    onValueChange={(v) =>
                      setDef({
                        ...def,
                        policy: { ...def.policy, rejectTo: v as "drafter" | "previous" },
                      })
                    }
                  >
                    <SelectTrigger id="form-rejectto" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="drafter">기안자에게</SelectItem>
                      <SelectItem value="previous">직전 결재 단계로</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={def.policy.auditCanReject}
                    onChange={(e) =>
                      setDef({
                        ...def,
                        policy: { ...def.policy, auditCanReject: e.target.checked },
                      })
                    }
                  />
                  감사 단계에서 반려할 수 있다
                </label>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">문서번호</CardTitle>
                <CardDescription>
                  토큰: {"{사업자코드} {부서코드} {양식코드} {YYYY} {YY} {MM} {SEQ:4}"} —{" "}
                  {"{SEQ:n}"}은 정확히 하나 필요합니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={def.numbering !== null}
                    onChange={(e) =>
                      setDef({ ...def, numbering: e.target.checked ? DEFAULT_DEF.numbering : null })
                    }
                  />
                  문서번호를 자동 부여한다
                </label>
                {def.numbering && (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="num-rule">규칙</Label>
                      <Input
                        id="num-rule"
                        value={def.numbering.rule}
                        onChange={(e) =>
                          setDef({
                            ...def,
                            numbering: {
                              ...(def.numbering as NonNullable<FormDefinition["numbering"]>),
                              rule: e.target.value,
                            },
                          })
                        }
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="num-cycle">순번 초기화</Label>
                      <Select
                        value={def.numbering.cycle}
                        onValueChange={(v) =>
                          setDef({
                            ...def,
                            numbering: {
                              ...(def.numbering as NonNullable<FormDefinition["numbering"]>),
                              cycle: v as "year" | "month" | "none",
                            },
                          })
                        }
                      >
                        <SelectTrigger id="num-cycle" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="year">해마다</SelectItem>
                          <SelectItem value="month">달마다</SelectItem>
                          <SelectItem value="none">안 함</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="num-at">부여 시점</Label>
                      <Select
                        value={def.numbering.at}
                        onValueChange={(v) =>
                          setDef({
                            ...def,
                            numbering: {
                              ...(def.numbering as NonNullable<FormDefinition["numbering"]>),
                              at: v as "submit" | "complete",
                            },
                          })
                        }
                      >
                        <SelectTrigger id="num-at" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="submit">상신할 때</SelectItem>
                          <SelectItem value="complete">완료할 때</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">기본 결재선</CardTitle>
                <CardDescription>
                  기안 때 처음 채워지는 결재선입니다. 후결 단계는 여기에 있는 만큼만 기안자가 쓸 수
                  있습니다.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LineEditor
                  rows={rows}
                  onChange={setRows}
                  ctx={ctx}
                  maxCells={policy?.approvalLineMaxCells}
                  allowPost
                />
              </CardContent>
            </Card>

            {errors.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>저장할 수 없습니다</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5">
                    {errors.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
        <ActionBar className="sticky bottom-0 border-t bg-background py-3">
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              try {
                await autosave.flush();
                router.push("/admin/forms");
              } catch (error) {
                setErrors([errorMessage(error)]);
              }
            }}
          >
            목록
          </Button>
          <Button
            type="submit"
            variant="default"
            disabled={
              saving ||
              !schemaCheck.ok ||
              !layoutCheck.ok ||
              autosave.status.kind === "conflict" ||
              autosave.status.kind === "error"
            }
          >
            {saving ? "저장 중…" : isNew ? "양식 만들기" : "새 버전으로 저장"}
          </Button>
        </ActionBar>
      </ApprovalPageLayout>
    </form>
  );
}

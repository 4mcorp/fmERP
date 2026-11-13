"use client";

import { api, errorMessage } from "@fmerp/shared/lib/api";
import { formatDateTime } from "@fmerp/shared/lib/types";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { Input } from "@fmerp/shared/ui/input";
import { Label } from "@fmerp/shared/ui/label";
import { LoadingState } from "@fmerp/shared/ui/loading-state";
import { PinDialog } from "@fmerp/shared/ui/pin-dialog";
import { QueryErrorState } from "@fmerp/shared/ui/query-error-state";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import {
  AGENT_SCOPES,
  type AgentScope,
  type AgentTokenInput,
  AgentTokenInputSchema,
  type AgentTokenSummary,
} from "../../agent-token-schema";

const LABELS: Record<AgentScope, string> = {
  "forms.read": "양식 조회",
  "forms.write": "양식 초안 작성",
  "forms.publish.propose": "양식 게시 제안",
  "documents.read": "문서 조회",
  "documents.draft.write": "문서 초안 작성",
  "documents.comment.write": "의견 추가",
  "documents.submit.propose": "문서 상신 제안",
  "org.read": "조직 조회",
  "org.history.read": "구성원 이력 조회",
  "org.write": "조직 변경",
  "org.sensitive.propose": "민감한 조직 변경 제안",
  "invitations.read": "초대 목록 조회",
  "invitations.propose": "초대 생성·폐기 제안",
};

export function AgentTokenSection({ accountId, hasPin }: { accountId: string; hasPin: boolean }) {
  const tokens = useQuery({
    queryKey: ["agent-tokens", accountId],
    queryFn: () => api<AgentTokenSummary[]>("/api/me/agent-tokens"),
  });
  const [name, setName] = useState("");
  const [days, setDays] = useState(7);
  const [scopes, setScopes] = useState<AgentScope[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<AgentTokenInput | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function prepare(event: FormEvent) {
    event.preventDefault();
    const parsed = AgentTokenInputSchema.safeParse({
      name,
      scopes,
      expiresInDays: days,
      confirmed,
    });
    if (!parsed.success) {
      setError("이름·1개 이상의 권한·1~30일 만료·주의사항 확인이 필요합니다.");
      return;
    }
    setError(null);
    setSecret(null);
    setPending(parsed.data);
  }
  async function issue() {
    if (!pending || busy) return;
    const input = pending;
    setPending(null);
    setBusy(true);
    try {
      const result = await api<{ token: string }>("/api/me/agent-tokens", {
        method: "POST",
        body: input,
      });
      setSecret(result.token);
      setName("");
      setScopes([]);
      setConfirmed(false);
      await tokens.refetch();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    try {
      await api(`/api/me/agent-tokens/${id}`, { method: "DELETE" });
      setSecret(null);
      await tokens.refetch();
      toast.success("토큰을 폐기했습니다");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>에이전트 연결</CardTitle>
        <CardDescription>
          현재 회사의 본인 권한 안에서만 동작합니다. PIN과 웹 세션은 에이전트에 전달하지 마세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p>
          조회 권한만으로도 회사 문서가 외부 AI에 전달될 수 있습니다. 필요한 권한만 선택하세요.
          제안은 사람이 웹에서 확인하기 전에는 실행되지 않습니다.
        </p>
        {secret && (
          <section className="flex min-w-0 flex-col gap-2" aria-label="발급된 토큰">
            <p role="status">
              토큰은 지금 한 번만 표시됩니다. 안전한 비밀 저장소에 저장하세요. 채팅에 붙여 넣지
              마세요.
            </p>
            <Label htmlFor="agent-secret">발급된 토큰</Label>
            <Input id="agent-secret" value={secret} readOnly autoComplete="off" />
            <Button variant="outline" onClick={() => setSecret(null)}>
              저장했습니다. 토큰 숨기기
            </Button>
          </section>
        )}
        <form onSubmit={prepare} className="flex flex-col gap-3">
          <Label htmlFor="agent-name">연결 이름</Label>
          <Input
            id="agent-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            autoComplete="off"
          />
          <Label htmlFor="agent-days">만료까지 일수 (1~30일)</Label>
          <Input
            id="agent-days"
            type="number"
            min={1}
            max={30}
            step={1}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            required
          />
          <fieldset className="flex flex-col gap-2">
            <legend>허용할 권한 (기본 선택 없음)</legend>
            {AGENT_SCOPES.map((scope) => (
              <Label key={scope} className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={(e) =>
                    setScopes(
                      e.target.checked ? [...scopes, scope] : scopes.filter((s) => s !== scope),
                    )
                  }
                />
                {LABELS[scope]}
              </Label>
            ))}
          </fieldset>
          <Label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              required
            />
            외부 AI에 데이터가 전달될 수 있음을 이해하고 선택한 권한으로 발급합니다.
          </Label>
          {error && <p role="alert">{error}</p>}
          <Button type="submit" disabled={busy}>
            PIN 확인 후 토큰 발급
          </Button>
        </form>
        <PinDialog
          open={pending !== null}
          needsSetup={!hasPin}
          onClose={() => setPending(null)}
          onVerified={() => void issue()}
          description="에이전트 토큰을 발급하려면 결재 PIN으로 본인을 확인하세요. PIN은 에이전트에 전달되지 않습니다."
          setupDescription="에이전트 토큰 발급 전에 결재 PIN을 설정하세요."
        />
        {tokens.isError ? (
          <QueryErrorState onRetry={() => tokens.refetch()} />
        ) : !tokens.data ? (
          <LoadingState />
        ) : (
          <section aria-label="내 에이전트 토큰">
            <h2>발급 이력</h2>
            {tokens.data.length === 0 && <p>발급한 토큰이 없습니다.</p>}
            <ul className="flex flex-col gap-3">
              {tokens.data.map((token) => (
                <li key={token.id} className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
                  <strong className="break-words">{token.name}</strong>
                  <span>{token.scopes.map((scope) => LABELS[scope]).join(", ")}</span>
                  <span>만료 {formatDateTime(token.expiresAt)}</span>
                  <span>
                    마지막 사용{" "}
                    {token.lastUsedAt ? formatDateTime(token.lastUsedAt) : "사용 이력 없음"}
                  </span>
                  {token.revokedAt ? (
                    <span>폐기됨</span>
                  ) : (
                    <Button
                      variant="outline"
                      disabled={busy}
                      aria-label={`${token.name} 토큰 폐기`}
                      onClick={() => void revoke(token.id)}
                    >
                      즉시 폐기
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}

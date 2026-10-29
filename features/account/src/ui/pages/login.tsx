"use client";

import { api } from "@fmerp/shared/lib/api";
import { Alert, AlertDescription } from "@fmerp/shared/ui/alert";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent } from "@fmerp/shared/ui/card";
import { useEffect, useState } from "react";
import { AuthLayout } from "../components/auth-layout";
import { authClient, usePasskeySupport } from "../lib/auth-client";

const LOGIN_FAILED =
  "패스키로 로그인하지 못했습니다. 기기 잠금 해제를 다시 시도하거나 관리자에게 문의하세요.";
const ENROLL_FAILED =
  "등록 링크를 사용할 수 없습니다. 만료되었거나 이미 사용된 링크일 수 있습니다. 관리자에게 새 링크를 요청하세요.";
const UNSUPPORTED =
  "이 브라우저는 패스키를 지원하지 않습니다. 최신 Safari·Chrome·삼성 인터넷에서 열어 주세요.";

/** 로그인 화면 (PK2). `?token=`이 있으면 관리자가 준 등록 링크이므로 최초 패스키 등록 화면을 보여 준다 */
export default function LoginPage() {
  const [params, setParams] = useState<{ token: string | null; next: string } | null>(null);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const token = search.get("token");
    const next = search.get("next");
    // 등록 링크 토큰이 주소창·브라우저 기록에 남지 않도록 바로 지운다.
    // StrictMode(개발)는 effect를 두 번 실행하고 두 번째는 지워진 URL을 읽으므로,
    // 첫 실행이 정한 상태를 null로 덮어쓰지 않게 prev를 우선한다.
    if (token) window.history.replaceState(null, "", "/login");
    setParams((prev) => prev ?? { token, next: next?.startsWith("/") ? next : "/" });
  }, []);

  if (!params) return null;
  return params.token ? <EnrollPanel token={params.token} /> : <LoginPanel next={params.next} />;
}

/** 테스트 계정 로그인이 켜진 환경인지 확인한다. 꺼져 있으면 서버가 404를 주므로 링크를 숨긴다 */
function useDevTestLoginEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/dev/test-accounts")
      .then((res) => alive && setEnabled(res.ok))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}

/** ID 입력 없이 passkey(discoverable credential)로 로그인한다. Google 안내 문구는 PK2에서 뺐다 */
function LoginPanel({ next }: { next: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = usePasskeySupport();
  const devLogin = useDevTestLoginEnabled();

  async function login() {
    if (!supported) return;
    setBusy(true);
    setError(null);
    try {
      const { error: signInError } = await authClient.signIn.passkey();
      if (signInError) {
        setError(LOGIN_FAILED);
        setBusy(false);
        return;
      }
      window.location.href = next;
    } catch {
      setError(LOGIN_FAILED);
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="4mERP 로그인"
      description="이 기기에 등록한 패스키(지문·얼굴·화면 잠금 PIN)로 로그인합니다."
    >
      <Card>
        <CardContent className="space-y-4 pt-6">
          {supported === false && (
            <Alert>
              <AlertDescription>{UNSUPPORTED}</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button
            type="button"
            className="h-11 w-full"
            onClick={login}
            disabled={supported !== true || busy}
          >
            {busy ? "확인하는 중…" : "패스키로 로그인"}
          </Button>
          <p className="text-xs text-muted-foreground">
            패스키가 아직 없다면 관리자가 보낸 등록 링크를 여세요.
          </p>
          {devLogin && (
            <a
              href={`/dev-login?next=${encodeURIComponent(next)}`}
              className="block text-center text-sm text-muted-foreground underline underline-offset-4"
            >
              테스트 계정으로 로그인 (개발·테스트 환경 전용)
            </a>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

/** 내 소속 중 재직(active) 첫 회사를 활성 회사로 정한다. 기존 PK1 API(/api/me, /api/accounts/active)만 쓴다 */
async function activateFirstAccount() {
  const me = await api<{ accounts: { accountId: string; status: string }[] }>("/api/me");
  const first = me.accounts.find((a) => a.status === "active");
  if (!first) return;
  await api("/api/accounts/active", { method: "POST", body: { accountId: first.accountId } });
}

/** 관리자 등록 링크로 최초 passkey를 만든다. 등록과 함께 로그인된다 (createSession) */
function EnrollPanel({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = usePasskeySupport();

  async function enroll() {
    if (!supported) return;
    setBusy(true);
    setError(null);
    try {
      const { error: addError } = await authClient.passkey.addPasskey({
        context: token,
        name: `이 기기 ${new Date().toLocaleDateString("ko-KR")}`,
        createSession: true,
      });
      if (addError) {
        setError(ENROLL_FAILED);
        setBusy(false);
        return;
      }
      // 등록 링크 흐름은 세션만 만들고 활성 회사를 정하지 않는다(서버 afterLogin은 로그인에서만 돈다).
      // 패스키는 이미 만들어졌으므로 실패해도 홈으로 보내고, 홈에서 회사를 고르게 한다.
      try {
        await activateFirstAccount();
      } catch {
        // 활성 회사 설정 실패는 등록 실패가 아니다
      }
      window.location.href = "/";
    } catch {
      setError(ENROLL_FAILED);
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="패스키 만들기"
      description="이 기기에서 패스키를 만들면 다음부터 비밀번호 없이 로그인합니다. 관리자가 준 링크는 한 번만 쓸 수 있습니다."
    >
      <Card>
        <CardContent className="space-y-4 pt-6">
          {supported === false && (
            <Alert>
              <AlertDescription>{UNSUPPORTED}</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button
            type="button"
            className="h-11 w-full"
            onClick={enroll}
            disabled={supported !== true || busy}
          >
            {busy ? "패스키를 만드는 중…" : "이 기기에 패스키 만들기"}
          </Button>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

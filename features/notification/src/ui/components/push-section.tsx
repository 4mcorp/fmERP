"use client";

import { api, errorMessage } from "@fmerp/shared/lib/api";
import { Badge } from "@fmerp/shared/ui/badge";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Support =
  | { state: "checking" }
  | { state: "unsupported"; reason: string }
  | { state: "ready"; subscribed: boolean; publicKey: string };

/** base64url 문자열을 PushManager가 받는 바이트 배열로 바꾼다 */
function toBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * 이 기기의 웹 푸시 알림 (PWA). iOS는 홈 화면에 설치한 뒤에만 알림을 켤 수 있다.
 * 기기 구독은 구성원 단위가 아니라 브라우저·홈 화면 앱 하나에 묶인다.
 */
export function PushSection() {
  const [support, setSupport] = useState<Support>({ state: "checking" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled)
          setSupport({ state: "unsupported", reason: "이 브라우저는 웹 푸시를 지원하지 않습니다" });
        return;
      }
      if (isIos() && !isStandalone()) {
        if (!cancelled)
          setSupport({
            state: "unsupported",
            reason: "iPhone·iPad는 홈 화면에 추가한 뒤 그 앱에서만 알림을 켤 수 있습니다",
          });
        return;
      }
      const { publicKey } = await api<{ publicKey: string | null }>("/api/me/push/config");
      if (!publicKey) {
        if (!cancelled)
          setSupport({ state: "unsupported", reason: "서버에 웹 푸시 설정이 없습니다" });
        return;
      }
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!cancelled) setSupport({ state: "ready", subscribed: sub !== null, publicKey });
    })().catch((error: unknown) => {
      if (!cancelled) setSupport({ state: "unsupported", reason: errorMessage(error) });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable(publicKey: string) {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("알림 권한이 허용되지 않았습니다");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toBytes(publicKey),
      });
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("구독 정보가 올바르지 않습니다");
      }
      await api("/api/me/push/subscribe", {
        method: "POST",
        body: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
      });
      setSupport({ state: "ready", subscribed: true, publicKey });
      toast.success("이 기기에서 알림을 받습니다");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function disable(publicKey: string) {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api("/api/me/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setSupport({ state: "ready", subscribed: false, publicKey });
      toast.success("이 기기의 알림을 껐습니다");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="size-4" aria-hidden />이 기기 알림
          {support.state === "ready" ? (
            <Badge variant={support.subscribed ? "default" : "secondary"}>
              {support.subscribed ? "켜짐" : "꺼짐"}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          결재 알림을 이 기기로 받습니다. 알림에는 문서 제목·내용이 들어가지 않으며, 누르면 로그인
          후 해당 문서로 이동합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {support.state === "checking" ? (
          <p className="text-muted-foreground text-sm">확인 중…</p>
        ) : null}
        {support.state === "unsupported" ? (
          <p className="text-muted-foreground text-sm">{support.reason}</p>
        ) : null}
        {support.state === "unsupported" && isIos() && !isStandalone() ? (
          <p className="text-muted-foreground text-sm">
            Safari의 공유 버튼 → "홈 화면에 추가"로 4mERP를 설치한 뒤, 홈 화면의 4mERP 앱을 열어
            알림을 켜세요.
          </p>
        ) : null}
        {support.state === "ready" ? (
          <Button
            type="button"
            variant={support.subscribed ? "outline" : "default"}
            disabled={busy}
            onClick={() =>
              support.subscribed ? void disable(support.publicKey) : void enable(support.publicKey)
            }
          >
            {support.subscribed ? "이 기기 알림 끄기" : "이 기기 알림 켜기"}
          </Button>
        ) : null}
        <p className="text-muted-foreground text-xs">
          실기기 푸시 수신(iOS·삼성 인터넷)은 아직 검증되지 않았습니다. 확인 절차는
          docs/ops/prod.md를 보세요.
        </p>
      </CardContent>
    </Card>
  );
}

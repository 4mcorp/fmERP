"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";
import { useEffect, useState } from "react";

/** Better Auth 브라우저 클라이언트 (passkey 플러그인). 같은 출처의 /api/auth를 쓴다 */
export const authClient = createAuthClient({ plugins: [passkeyClient()] });

/**
 * WebAuthn 지원 여부. 서버 렌더와 첫 클라이언트 렌더가 같도록 마운트 뒤에 판정한다.
 * 판정 전(null)에는 버튼을 막고 안내를 숨긴다.
 */
export function usePasskeySupport(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    setSupported(typeof window.PublicKeyCredential !== "undefined");
  }, []);
  return supported;
}

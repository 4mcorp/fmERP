"use client";

import { formatDateTime } from "@fmerp/shared/lib/types";

/** passkey 등록 링크. 원문은 발급 응답에서 한 번만 받으므로 화면을 벗어나면 다시 볼 수 없다 (DB에는 해시만 있다) */
export function EnrollmentLinkBox({ token, expiresAt }: { token: string; expiresAt: string }) {
  const link = `${window.location.origin}/login?token=${token}`;
  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
      <p className="text-sm">
        등록 링크를 사용자에게 전달하세요. 이 화면을 벗어나면 다시 볼 수 없습니다. 만료:{" "}
        {formatDateTime(expiresAt)}
      </p>
      <code className="block break-all text-xs">{link}</code>
    </div>
  );
}

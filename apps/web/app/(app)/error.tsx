"use client";

import { QueryErrorState } from "@fmerp/shared/ui/query-error-state";

/** 앱 화면에서 렌더 오류가 났을 때의 안내. 다시 시도는 세그먼트를 새로 그린다 */
export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <QueryErrorState
      message="화면을 표시하지 못했습니다. 잠시 후 다시 시도해 주세요."
      onRetry={reset}
    />
  );
}

"use client";

import { api, errorMessage } from "@fmerp/shared/lib/api";
import { formatDateTime } from "@fmerp/shared/lib/format";
import { Button } from "@fmerp/shared/ui/button";
import { CollapsibleCard } from "@fmerp/shared/ui/collapsible-card";
import { Printer } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { type TimelineItem, useTimeline } from "../queries";

/** 같은 인쇄를 버튼 클릭과 브라우저의 beforeprint 이벤트가 겹쳐 두 번 기록하지 않도록 두는 간격 */
const PRINT_LOG_GAP_MS = 5_000;

/**
 * 인쇄 버튼 (AUD-020): 인쇄 사실을 서버에 기록한 뒤 인쇄한다.
 * 브라우저 메뉴·단축키(Ctrl+P)로 인쇄하는 경우도 `beforeprint`에서 최선을 다해 기록하지만,
 * 화면 캡처 같은 방법은 기록할 수 없다.
 */
export function PrintButton({ documentId }: { documentId: string }) {
  const last = useRef(0);

  async function log(): Promise<boolean> {
    if (Date.now() - last.current < PRINT_LOG_GAP_MS) return true;
    last.current = Date.now();
    try {
      await api(`/api/approvals/${documentId}/print-log`, { method: "POST" });
      return true;
    } catch (e) {
      last.current = 0;
      toast.error(errorMessage(e));
      return false;
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: log는 렌더마다 바뀌지만 documentId만 쓴다
  useEffect(() => {
    const onBeforePrint = () => {
      void log();
    };
    window.addEventListener("beforeprint", onBeforePrint);
    return () => window.removeEventListener("beforeprint", onBeforePrint);
  }, [documentId]);

  async function print() {
    if (await log()) window.print();
  }

  return (
    <Button variant="outline" size="sm" onClick={print} className="print:hidden">
      <Printer aria-hidden />
      인쇄
    </Button>
  );
}

/** 같은 시각의 같은 행위가 겹칠 수 있어, 같은 키가 나오면 번호를 붙여 구분한다 */
function withKeys(items: TimelineItem[]) {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = `${item.at}|${item.kind}|${item.actor ?? ""}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { key: n === 0 ? base : `${base}#${n}`, item };
  });
}

/** 문서 이력 타임라인 (AUD-011): 작성 → 상신 → 단계 처리(대결 포함) → 결재선 변경 → 내려받기·인쇄 → 완료 → 공람 */
export function DocumentTimeline({ documentId }: { documentId: string }) {
  const { data, error, isPending } = useTimeline(documentId, true);
  return (
    <CollapsibleCard title="이력" count={error || isPending ? undefined : data.length}>
      <div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(error)}
          </p>
        ) : isPending ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            불러오는 중…
          </p>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">기록이 없습니다.</p>
        ) : (
          <ol className="space-y-2">
            {withKeys(data).map(({ key, item }) => (
              <li key={key} className="rounded-lg border p-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{item.label}</span>
                  {item.actor && (
                    <span>
                      {item.actor}
                      {item.onBehalfOf ? ` (${item.onBehalfOf} 대결)` : ""}
                    </span>
                  )}
                  <time dateTime={item.at} className="text-xs text-muted-foreground">
                    {formatDateTime(item.at)}
                  </time>
                  {item.ip && <span className="text-xs text-muted-foreground">IP {item.ip}</span>}
                </div>
                {item.detail && (
                  <p className="mt-1 break-words whitespace-pre-wrap text-muted-foreground">
                    {item.detail}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </CollapsibleCard>
  );
}

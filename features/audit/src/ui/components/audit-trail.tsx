"use client";

import { ApiProblem, api, errorMessage } from "@fmerp/shared/lib/api";
import { formatDateTime } from "@fmerp/shared/lib/format";
import { A4PreviewFrame } from "@fmerp/shared/ui/a4-preview-frame";
import { ActionBar } from "@fmerp/shared/ui/action-bar";
import { Button } from "@fmerp/shared/ui/button";
import { CollapsibleCard } from "@fmerp/shared/ui/collapsible-card";
import { Modal } from "@fmerp/shared/ui/modal";
import { Printer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { type TimelineItem, useTimeline } from "../queries";

/** 같은 인쇄를 버튼 클릭과 브라우저의 beforeprint 이벤트가 겹쳐 두 번 기록하지 않도록 두는 간격 */
const PRINT_LOG_GAP_MS = 5_000;

type PreviewOrientation = "portrait" | "landscape";

/** 서버 X-Print-Orientation 헤더를 읽는다. 없거나 잘못된 값이면 portrait */
function orientationFrom(res: Response): PreviewOrientation {
  return res.headers.get("x-print-orientation") === "landscape" ? "landscape" : "portrait";
}

/** 출력 미리보기 HTML과 방향을 가져온다 (저장하지 않는다). 실패하면 서버 응답을 ApiProblem으로 바꾼다 */
async function fetchPreview(
  documentId: string,
): Promise<{ html: string; orientation: PreviewOrientation }> {
  const res = await fetch(`/api/approvals/${documentId}/print-preview`, {
    credentials: "same-origin",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      code?: string;
      title?: string;
      detail?: string;
    };
    throw new ApiProblem(
      res.status,
      body.code ?? "error",
      body.title ?? "미리보기를 열 수 없습니다",
      body.detail,
    );
  }
  return { html: await res.text(), orientation: orientationFrom(res) };
}

/**
 * 인쇄 처리: 인쇄 기록 → iframe 포커스 → iframe 인쇄. 기록에 실패하면 인쇄하지 않는다.
 * 훅을 쓰지 않으므로 PrintButton 밖에서 직접 테스트할 수 있다.
 */
export async function runPrint(
  frame: { current: HTMLIFrameElement | null },
  log: () => Promise<boolean>,
): Promise<void> {
  if (!(await log())) return;
  frame.current?.contentWindow?.focus();
  frame.current?.contentWindow?.print();
}

/**
 * 인쇄 버튼 (AUD-020). 누르면 A4 출력 미리보기를 모달로 먼저 보여 준다.
 * 모달의 "인쇄"가 미리보기 iframe의 print()를 부르며, 그때 인쇄 기록을 남긴다.
 * 미리보기만 여는 것은 기록하지 않는다. 브라우저 메뉴·단축키(Ctrl+P)로 인쇄하면
 * `beforeprint`에서 최선을 다해 기록하지만, 화면 캡처 같은 방법은 기록할 수 없다.
 */
export function PrintButton({ documentId }: { documentId: string }) {
  const last = useRef(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<{ html: string; orientation: PreviewOrientation } | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

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

  async function openPreview() {
    setOpen(true);
    setPreview(null);
    setLoadError(null);
    try {
      setPreview(await fetchPreview(documentId));
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }

  async function printPreview() {
    await runPrint(frame, log);
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openPreview} className="print:hidden">
        <Printer aria-hidden />
        인쇄
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="출력 미리보기"
        description="완료 문서와 같은 A4 형식입니다. 저장되지 않으며, 인쇄할 때 기록이 남습니다."
        className="w-[min(60rem,calc(100vw-2rem))]"
      >
        <div className="flex flex-col gap-3 p-4">
          {loadError ? (
            <p role="alert" className="text-sm text-destructive">
              {loadError}
            </p>
          ) : preview === null ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              불러오는 중…
            </p>
          ) : (
            <A4PreviewFrame
              title="출력 미리보기"
              html={preview.html}
              orientation={preview.orientation}
              iframeRef={frame}
              sandbox="allow-same-origin allow-modals"
              className="h-[70vh] w-full rounded border bg-white"
            />
          )}
          <ActionBar>
            <Button variant="outline" onClick={() => setOpen(false)}>
              닫기
            </Button>
            <Button variant="default" onClick={printPreview} disabled={preview === null}>
              <Printer aria-hidden />
              인쇄
            </Button>
          </ActionBar>
        </div>
      </Modal>
    </>
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

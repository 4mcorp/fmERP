import { type CSSProperties, type Ref, useLayoutEffect, useRef, useState } from "react";
import {
  computePreviewOffsetX,
  computePreviewScale,
  MM_TO_CSS_PX,
  PRINT_MARGIN_MM,
  type PreviewOrientation,
} from "../domain/document-preview-scale";

/**
 * A4 문서 HTML 미리보기 프레임.
 * iframe은 실제 용지 CSS px 폭으로 고정 렌더링하고, 컨테이너 폭에 맞춰 transform: scale()로 축소한다.
 * 인쇄 여백(상하 14mm, 좌우 12mm)은 화면 전용으로만 표시한다. iframe을 용지 안쪽 영역(여백을 뺀 크기)에
 * 여백만큼 띄워 배치하므로 여백 영역은 잘리지 않고 보인다. 출력 HTML/PDF는 바꾸지 않는다.
 * sandbox 기본값은 기존 미리보기(audit-trail.tsx)와 같은 "allow-same-origin allow-modals"이다.
 * 호출자가 sandbox를 넘기면 그 값을 그대로 쓴다.
 */
export interface A4PreviewFrameProps {
  /** buildPdfHtml 등이 만든 A4 HTML 문자열 */
  html: string;
  orientation: PreviewOrientation;
  /** iframe sandbox 값. 생략하면 기존 미리보기와 같은 기본값을 쓴다. */
  sandbox?: string;
  title?: string;
  className?: string;
  /** Rendered iframe ref, for callers that need to focus or print its content window. */
  iframeRef?: Ref<HTMLIFrameElement>;
}

const DEFAULT_SANDBOX = "allow-same-origin allow-modals";

export function A4PreviewFrame({
  html,
  orientation,
  sandbox = DEFAULT_SANDBOX,
  title = "문서 미리보기",
  className,
  iframeRef,
}: A4PreviewFrameProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidthPx, setContainerWidthPx] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidthPx(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setContainerWidthPx(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { scale, heightPx, pageWidthPx, pageHeightPx } = computePreviewScale({
    containerWidthPx,
    orientation,
  });

  const offsetXPx = computePreviewOffsetX({ containerWidthPx, orientation });

  const outerStyle: CSSProperties = {
    width: "100%",
    height: heightPx,
    overflow: "hidden",
  };

  // 화면 전용 인쇄 여백: iframe을 용지 안쪽 영역에 두고 여백만큼 띄운다.
  // 실제 출력 HTML/PDF의 @page 여백은 건드리지 않는다.
  const marginTopPx = PRINT_MARGIN_MM.vertical * MM_TO_CSS_PX;
  const marginSidePx = PRINT_MARGIN_MM.horizontal * MM_TO_CSS_PX;
  const frameWidthPx = pageWidthPx - marginSidePx * 2;
  const frameHeightPx = pageHeightPx - marginTopPx * 2;

  const innerStyle: CSSProperties = {
    width: pageWidthPx,
    height: pageHeightPx,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
    position: "relative",
    marginLeft: offsetXPx,
    background: "#fff",
  };

  const iframeStyle: CSSProperties = {
    position: "absolute",
    top: marginTopPx,
    left: marginSidePx,
    width: frameWidthPx,
    height: frameHeightPx,
    border: 0,
    display: "block",
  };

  return (
    <div ref={containerRef} className={className} data-slot="a4-preview-frame" style={outerStyle}>
      <div style={innerStyle}>
        <iframe ref={iframeRef} title={title} srcDoc={html} sandbox={sandbox} style={iframeStyle} />
      </div>
    </div>
  );
}

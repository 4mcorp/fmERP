// 결재 문서 A4 미리보기의 순수 축소 비율·높이 계산 (UX-2).
// 프레임워크·DOM에 의존하지 않는다. 화면은 이 값을 받아 transform: scale()과 높이에 쓴다.
//
// 단위 기준: mm → CSS px 변환은 CSS 표준 1in = 96px, 1in = 25.4mm 으로 한다.
//   px = mm × 96 / 25.4
// 용지 크기는 A4 세로 210×297mm, 가로 297×210mm 이다 (document-print.ts의 @page 기준과 일치).
// 인쇄 여백(@page)은 상하 14mm, 좌우 12mm 이다. 여백을 뺀 본문 폭과 높이 계산에 쓴다.
// 가로 본문 폭은 가로 용지 폭에서 좌우 여백을 뺀 값이다.
//
// 축소 규칙:
//   - 컨테이너 폭이 A4 가로 폭(여백 포함 용지 폭) 이상이면 scale은 1로 제한한다 (데스크톱 100%).
//   - 그보다 좁으면 scale = 컨테이너 폭 / 용지 폭 (용지 전체가 컨테이너에 들어가도록).
//   - 컨테이너 폭이 0 이하이거나 숫자가 아니면 scale은 0으로 둔다 (그릴 공간 없음).
//   - 높이 = 용지 높이(px) × scale. 축소된 시각 높이만큼 레이아웃 공간을 잡는다.

export type PreviewOrientation = "portrait" | "landscape";

export interface PreviewScaleInput {
  /** 미리보기가 들어갈 컨테이너의 CSS 폭(px) */
  containerWidthPx: number;
  orientation: PreviewOrientation;
}

export interface PreviewScaleResult {
  /** 0~1 사이의 축소 비율 (1 이하로 제한) */
  scale: number;
  /** 축소를 적용한 미리보기 높이(px) */
  heightPx: number;
  /** 용지 폭(px, 축소 전) */
  pageWidthPx: number;
  /** 용지 높이(px, 축소 전) */
  pageHeightPx: number;
}

/** mm → CSS px (1in = 25.4mm = 96px 기준) */
export const MM_TO_CSS_PX = 96 / 25.4;

/** A4 세로 기준 용지 크기 (mm) */
export const A4_PORTRAIT_MM = { width: 210, height: 297 } as const;

/** 인쇄 여백 (mm): 상하 14, 좌우 12 — document-print.ts의 `@page { margin: 14mm 12mm; }` */
export const PRINT_MARGIN_MM = { vertical: 14, horizontal: 12 } as const;

/**
 * 컨테이너 폭에 맞춘 A4 미리보기 축소 비율과 높이를 계산한다.
 * 입력이 컨테이너보다 넓어도 scale은 1을 넘기지 않는다(확대하지 않는다).
 */
export function computePreviewScale(input: PreviewScaleInput): PreviewScaleResult {
  const portraitWidthMm = A4_PORTRAIT_MM.width;
  const portraitHeightMm = A4_PORTRAIT_MM.height;
  const pageWidthMm = input.orientation === "landscape" ? portraitHeightMm : portraitWidthMm;
  const pageHeightMm = input.orientation === "landscape" ? portraitWidthMm : portraitHeightMm;

  const pageWidthPx = pageWidthMm * MM_TO_CSS_PX;
  const pageHeightPx = pageHeightMm * MM_TO_CSS_PX;

  const containerWidth = input.containerWidthPx;
  if (
    typeof containerWidth !== "number" ||
    !Number.isFinite(containerWidth) ||
    containerWidth <= 0
  ) {
    return { scale: 0, heightPx: 0, pageWidthPx, pageHeightPx };
  }

  const rawScale = containerWidth / pageWidthPx;
  const scale = Math.min(1, rawScale);

  return {
    scale,
    heightPx: pageHeightPx * scale,
    pageWidthPx,
    pageHeightPx,
  };
}

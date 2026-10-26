import { describe, expect, it } from "vitest";
import { A4_PORTRAIT_MM, computePreviewScale, MM_TO_CSS_PX } from "./document-preview-scale";

const A4_PORTRAIT_PX = A4_PORTRAIT_MM.width * MM_TO_CSS_PX;
const A4_LANDSCAPE_PX = A4_PORTRAIT_MM.height * MM_TO_CSS_PX;

describe("computePreviewScale (UX-2 A4 미리보기)", () => {
  it("mm→px 변환은 1in=25.4mm=96px 기준이다", () => {
    expect(MM_TO_CSS_PX).toBeCloseTo(96 / 25.4, 10);
    expect(A4_PORTRAIT_PX).toBeCloseTo(793.7, 1);
  });

  it("360px 모바일 컨테이너에서는 A4 세로가 폭에 맞게 축소된다", () => {
    const r = computePreviewScale({ containerWidthPx: 360, orientation: "portrait" });
    expect(r.scale).toBeCloseTo(360 / A4_PORTRAIT_PX, 10);
    expect(r.scale).toBeLessThan(1);
    expect(r.heightPx).toBeCloseTo(r.pageHeightPx * r.scale, 6);
  });

  it("390px 모바일 컨테이너에서도 축소 비율이 폭 비율과 같다", () => {
    const r = computePreviewScale({ containerWidthPx: 390, orientation: "portrait" });
    expect(r.scale).toBeCloseTo(390 / A4_PORTRAIT_PX, 10);
    expect(r.heightPx).toBeCloseTo(r.pageHeightPx * r.scale, 6);
  });

  it("가로 용지는 가로 폭(297mm)을 기준으로 축소한다", () => {
    const r = computePreviewScale({ containerWidthPx: 360, orientation: "landscape" });
    expect(r.pageWidthPx).toBeCloseTo(A4_LANDSCAPE_PX, 6);
    expect(r.pageHeightPx).toBeCloseTo(A4_PORTRAIT_PX, 6);
    expect(r.scale).toBeCloseTo(360 / A4_LANDSCAPE_PX, 10);
  });

  it("1280px 데스크톱(모달 60rem 포함)은 용지가 들어가므로 scale을 1로 제한한다", () => {
    const r = computePreviewScale({ containerWidthPx: 1280, orientation: "portrait" });
    expect(r.scale).toBe(1);
    expect(r.heightPx).toBeCloseTo(r.pageHeightPx, 6);
  });

  it("컨테이너 폭이 A4 폭과 같으면 scale은 정확히 1이다", () => {
    const r = computePreviewScale({ containerWidthPx: A4_PORTRAIT_PX, orientation: "portrait" });
    expect(r.scale).toBe(1);
  });

  it("컨테이너 폭이 0 이하이면 scale과 높이는 0이다", () => {
    for (const w of [0, -10]) {
      const r = computePreviewScale({ containerWidthPx: w, orientation: "portrait" });
      expect(r.scale, `width=${w}`).toBe(0);
      expect(r.heightPx, `width=${w}`).toBe(0);
    }
  });

  it("숫자가 아니거나 유한하지 않은 폭도 0으로 처리한다", () => {
    for (const w of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = computePreviewScale({ containerWidthPx: w, orientation: "portrait" });
      expect(r.scale, `width=${w}`).toBe(0);
    }
  });

  it("축소 높이는 용지 높이 × 비율이다", () => {
    const r = computePreviewScale({ containerWidthPx: 500, orientation: "portrait" });
    expect(r.heightPx).toBeCloseTo(r.pageHeightPx * (500 / r.pageWidthPx), 6);
  });
});

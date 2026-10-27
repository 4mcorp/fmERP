// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement, createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { A4PreviewFrame } from "./a4-preview-frame";

afterEach(() => cleanup());

describe("A4PreviewFrame", () => {
  it("iframe을 srcDoc과 기본 sandbox로 렌더한다", () => {
    const { container } = render(
      createElement(A4PreviewFrame, { html: "<p>본문</p>", orientation: "portrait" }),
    );
    const iframe = container.querySelector("iframe");

    expect(container.querySelector('[data-slot="a4-preview-frame"]')).toBeTruthy();
    expect(iframe?.getAttribute("srcdoc")).toBe("<p>본문</p>");
    expect(iframe?.getAttribute("sandbox")).toBe("allow-same-origin allow-modals");
  });

  it("iframeRef는 실제 렌더된 iframe DOM을 가리킨다", () => {
    const iframeRef = createRef<HTMLIFrameElement>();
    const { container } = render(
      createElement(A4PreviewFrame, {
        html: "<p>인쇄</p>",
        orientation: "portrait",
        iframeRef,
      }),
    );

    const iframe = iframeRef.current;
    expect(iframe).toBe(container.querySelector("iframe"));
    if (!iframe) throw new Error("iframe ref was not assigned");

    const focus = vi.fn();
    const print = vi.fn();
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: { focus, print },
    });
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();

    expect(focus).toHaveBeenCalledOnce();
    expect(print).toHaveBeenCalledOnce();
  });

  it("호출자가 넘긴 sandbox 값을 그대로 쓴다", () => {
    const { container } = render(
      createElement(A4PreviewFrame, {
        html: "<p>x</p>",
        orientation: "portrait",
        sandbox: "allow-scripts",
      }),
    );

    expect(container.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("용지 CSS px 폭으로 iframe을 고정하고 축소는 transform으로 한다", () => {
    const { container } = render(
      createElement(A4PreviewFrame, { html: "", orientation: "portrait" }),
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const inner = iframe.parentElement as HTMLElement;

    // A4 세로 210mm = 약 793.7px (96/25.4 기준). iframe은 좌우 여백(12mm)을 뺀 폭이다.
    const marginH = 12 * (96 / 25.4);
    expect(parseFloat(iframe.style.width)).toBeCloseTo(210 * (96 / 25.4) - marginH * 2, 1);
    expect(inner.style.transformOrigin).toBe("top left");
    expect(inner.style.transform).toMatch(/^scale\(/);
  });

  it("iframe은 여백만큼 안쪽에 배치되어 페이지 가장자리에서 잘리지 않는다", () => {
    const { container } = render(
      createElement(A4PreviewFrame, { html: "", orientation: "portrait" }),
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const pageWidth = 210 * (96 / 25.4);
    const pageHeight = 297 * (96 / 25.4);
    const marginV = 14 * (96 / 25.4);
    const marginH = 12 * (96 / 25.4);

    expect(parseFloat(iframe.style.left)).toBeCloseTo(marginH, 1);
    expect(parseFloat(iframe.style.top)).toBeCloseTo(marginV, 1);
    expect(parseFloat(iframe.style.width)).toBeCloseTo(pageWidth - marginH * 2, 1);
    expect(parseFloat(iframe.style.height)).toBeCloseTo(pageHeight - marginV * 2, 1);
  });

  it("가로 방향이면 iframe 폭이 세로 높이 기준이 된다", () => {
    const portrait = render(createElement(A4PreviewFrame, { html: "", orientation: "portrait" }));
    const portraitWidth = parseFloat(
      (portrait.container.querySelector("iframe") as HTMLIFrameElement).style.width,
    );
    portrait.unmount();

    const landscape = render(createElement(A4PreviewFrame, { html: "", orientation: "landscape" }));
    const landscapeWidth = parseFloat(
      (landscape.container.querySelector("iframe") as HTMLIFrameElement).style.width,
    );

    const marginH = 12 * (96 / 25.4);
    expect(landscapeWidth).toBeCloseTo(297 * (96 / 25.4) - marginH * 2, 1);
    expect(landscapeWidth).toBeGreaterThan(portraitWidth);
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 실제 PrintButton을 렌더해 인쇄 연결을 검증한다. 훅·네트워크·토스트 경계만 mock한다.
const apiMock = vi.hoisted(() => vi.fn(async () => ({})));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@fmerp/shared/lib/api", () => ({
  api: apiMock,
  errorMessage: () => "error",
  ApiProblem: class extends Error {},
}));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("../src/ui/queries", () => ({ useTimeline: () => ({}) }));

const { PrintButton } = await import("../src/ui/components/audit-trail");
const { computePreviewScale } = await import("@fmerp/shared/domain/document-preview-scale");

beforeEach(() => {
  // jsdom에 없는 브라우저 dialog 표시 API만 보완하고 실제 Modal을 렌더한다.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PREVIEW_HTML = "<p>출력 미리보기</p>";

/** 미리보기 fetch 응답. 헤더 방향을 테스트별로 정한다 (null이면 헤더를 빼 둔다) */
function stubPreviewFetch(orientation: string | null) {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
  if (orientation !== null) headers.set("x-print-orientation", orientation);
  const fetchMock = vi.fn(async () => new Response(PREVIEW_HTML, { status: 200, headers }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** iframe contentWindow의 focus·print 호출 순서를 기록한다 */
function recordFramePrintOrder(order: string[]) {
  vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get").mockReturnValue({
    focus: () => order.push("focus"),
    print: () => order.push("print"),
  } as unknown as Window);
}

/** 방향별 용지 크기(px, 축소 전). 실제 A4PreviewFrame과 같은 계산 함수를 쓴다 */
function expectedPageSize(orientation: "portrait" | "landscape") {
  const { pageWidthPx, pageHeightPx } = computePreviewScale({
    containerWidthPx: 10_000,
    orientation,
  });
  return { width: pageWidthPx, height: pageHeightPx };
}

/** 렌더된 미리보기 용지(축소 전 innerStyle)의 width·height(px)를 읽는다 */
function pageStyleOf(view: ReturnType<typeof render>) {
  const frame = view.container.querySelector<HTMLElement>('[data-slot="a4-preview-frame"]');
  const page = frame?.firstElementChild as HTMLElement | null;
  return {
    width: Number.parseFloat(page?.style.width ?? "NaN"),
    height: Number.parseFloat(page?.style.height ?? "NaN"),
  };
}

async function openPreview(view: ReturnType<typeof render>) {
  fireEvent.click(view.getByRole("button", { name: "인쇄" }));
  await waitFor(() => expect(view.container.querySelector("iframe")).not.toBeNull());
}

/** 열린 미리보기 모달의 인쇄 버튼. 트리거와 이름이 같아, 모달(뒤에 렌더됨)의 마지막 "인쇄"를 고른다 */
function modalPrintButton(view: ReturnType<typeof render>) {
  const buttons = view.getAllByRole("button", { name: "인쇄" });
  const modalButton = buttons[buttons.length - 1];
  if (!modalButton || buttons.length < 2) throw new Error("preview modal print button not found");
  return modalButton;
}

describe("PrintButton 인쇄 연결 (AUD-020)", () => {
  let windowPrint: ReturnType<typeof vi.fn>;
  let order: string[];

  beforeEach(() => {
    apiMock.mockClear();
    toastError.mockClear();
    order = [];
    windowPrint = vi.fn();
    vi.stubGlobal("print", windowPrint);
    apiMock.mockImplementation(async () => {
      order.push("log");
      return {};
    });
  });

  it("(a) 미리보기 열기만으로는 인쇄 기록(print-log)을 남기지 않는다", async () => {
    stubPreviewFetch("portrait");
    const view = render(createElement(PrintButton, { documentId: "doc-1" }));

    await openPreview(view);

    expect(apiMock).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it("(b) 모달 인쇄는 기록 POST 성공 후 iframe focus → print 순서로 호출한다", async () => {
    stubPreviewFetch("portrait");
    recordFramePrintOrder(order);
    const view = render(createElement(PrintButton, { documentId: "doc-1" }));
    await openPreview(view);

    fireEvent.click(modalPrintButton(view));

    await waitFor(() => expect(order).toEqual(["log", "focus", "print"]));
    expect(apiMock).toHaveBeenCalledWith("/api/approvals/doc-1/print-log", { method: "POST" });
  });

  it("(c) 어떤 경로에서도 부모 window.print는 호출되지 않는다", async () => {
    stubPreviewFetch("portrait");
    recordFramePrintOrder(order);
    const view = render(createElement(PrintButton, { documentId: "doc-1" }));
    await openPreview(view);

    fireEvent.click(modalPrintButton(view));
    await waitFor(() => expect(order).toContain("print"));

    expect(windowPrint).not.toHaveBeenCalled();
  });

  it("(c-2) 기록 POST가 실패하면 iframe을 인쇄하지 않는다", async () => {
    stubPreviewFetch("portrait");
    recordFramePrintOrder(order);
    apiMock.mockImplementation(async () => {
      throw new Error("down");
    });
    const view = render(createElement(PrintButton, { documentId: "doc-1" }));
    await openPreview(view);

    fireEvent.click(modalPrintButton(view));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(order).not.toContain("focus");
    expect(order).not.toContain("print");
  });

  it("(d) 헤더 landscape면 A4PreviewFrame이 landscape 치수로 그린다", async () => {
    stubPreviewFetch("landscape");
    const view = render(createElement(PrintButton, { documentId: "doc-1" }));
    await openPreview(view);

    // landscape 용지는 가로가 세로보다 길다 (A4 가로 297mm). 실제 렌더 치수로 확인한다
    const page = pageStyleOf(view);
    expect(page.width).toBeGreaterThan(page.height);
    expect(page.width).toBeCloseTo(expectedPageSize("landscape").width, 1);
  });

  it("(d-2) 헤더가 없으면 portrait 치수로 그린다", async () => {
    stubPreviewFetch(null);
    const view = render(createElement(PrintButton, { documentId: "doc-1" }));
    await openPreview(view);

    // portrait 용지는 세로가 가로보다 길다 (A4 세로 210mm)
    const page = pageStyleOf(view);
    expect(page.height).toBeGreaterThan(page.width);
    expect(page.width).toBeCloseTo(expectedPageSize("portrait").width, 1);
  });
});

// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ComponentProps, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiProblem, api } from "../lib/api";
import { PinDialog } from "./pin-dialog";
import { useReauth } from "./use-reauth";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  api: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const request = vi.mocked(api);

function mount(props: Partial<ComponentProps<typeof PinDialog>> = {}) {
  const callbacks = { onClose: vi.fn(), onVerified: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (overrides: Partial<ComponentProps<typeof PinDialog>> = {}) =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(PinDialog, {
        open: true,
        needsSetup: true,
        ...callbacks,
        ...props,
        ...overrides,
      }),
    );
  const result = render(view());
  return {
    ...result,
    ...callbacks,
    redraw: (overrides: Partial<ComponentProps<typeof PinDialog>>) =>
      result.rerender(view(overrides)),
  };
}

async function savePin() {
  fireEvent.change(screen.getByLabelText("새 PIN (숫자 6~12자리)"), {
    target: { value: "123456" },
  });
  fireEvent.change(screen.getByLabelText("PIN 다시 입력"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "설정하고 계속" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/api/me/pin", { method: "PUT", body: { pin: "123456" } }),
  );
}

function verifyPin() {
  fireEvent.change(screen.getByLabelText("결재 PIN"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "확인하고 계속" }));
}

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ ok: true });
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
  vi.restoreAllMocks();
});

describe("PinDialog 재인증 통합", () => {
  it("공통 폼 설정 후 닫거나 작업을 실행하지 않고 같은 대화상자에서 실제 PIN 확인을 기다린다", async () => {
    const { onClose, onVerified } = mount();
    const dialog = screen.getByRole("dialog");
    await savePin();
    await screen.findByRole("heading", { name: "결재 PIN 확인" });
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(onClose).not.toHaveBeenCalled();
    expect(onVerified).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    verifyPin();
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenLastCalledWith("/api/me/pin/verify", {
      method: "POST",
      body: { pin: "123456" },
    });
  });

  it("설정 오류가 지속되며 재시도 성공 전에는 확인 단계로 가지 않는다", async () => {
    request.mockRejectedValueOnce(new ApiProblem(400, "pin_format", "설정 실패"));
    const { onClose, onVerified } = mount();
    await savePin();
    expect((await screen.findByRole("alert")).textContent).toBe("설정 실패");
    fireEvent.change(screen.getByLabelText("PIN 다시 입력"), { target: { value: "123456" } });
    expect(screen.getByRole("alert").textContent).toBe("설정 실패");
    expect(onClose).not.toHaveBeenCalled();
    expect(onVerified).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "설정하고 계속" }));
    await screen.findByLabelText("결재 PIN");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("확인 오류와 대기 콜백은 유지하고 실제 확인 성공 후에만 한 번 실행한다", async () => {
    const { onVerified } = mount();
    await savePin();
    await screen.findByLabelText("결재 PIN");
    request.mockRejectedValueOnce(new ApiProblem(400, "pin_mismatch", "PIN 불일치"));
    verifyPin();
    expect((await screen.findByRole("alert")).textContent).toBe("PIN 불일치");
    expect(onVerified).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("결재 PIN"), { target: { value: "654321" } });
    expect(screen.getByRole("alert").textContent).toBe("PIN 불일치");
    verifyPin();
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["취소", "close"])(
    "설정 중 %s 후 재열면 공통 폼의 입력과 오류를 비운다",
    async (action) => {
      request.mockRejectedValueOnce(new ApiProblem(400, "pin_format", "설정 실패"));
      const { redraw, onClose } = mount();
      await savePin();
      await screen.findByRole("alert");
      if (action === "취소") fireEvent.click(screen.getByRole("button", { name: action }));
      else fireEvent(screen.getByRole("dialog"), new Event("close"));
      expect(onClose).toHaveBeenCalledTimes(1);
      redraw({ open: false });
      redraw({ open: true });
      expect((screen.getByLabelText("새 PIN (숫자 6~12자리)") as HTMLInputElement).value).toBe("");
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it.each(["취소", "close", "external"])(
    "확인 중 %s 후 재열면 PIN과 오류를 비우고 저장된 PIN 확인 단계를 유지한다",
    async (action) => {
      const { redraw } = mount();
      await savePin();
      await screen.findByLabelText("결재 PIN");
      request.mockRejectedValueOnce(new ApiProblem(400, "pin_mismatch", "PIN 불일치"));
      verifyPin();
      await screen.findByRole("alert");
      if (action === "취소") fireEvent.click(screen.getByRole("button", { name: action }));
      else if (action === "close") fireEvent(screen.getByRole("dialog"), new Event("close"));
      redraw({ open: false });
      redraw({ open: true });
      expect((screen.getByLabelText("결재 PIN") as HTMLInputElement).value).toBe("");
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("explicit onPinSetup의 기존 닫기→후속 콜백 계약을 보존하고 onVerified를 호출하지 않는다", async () => {
    const events: string[] = [];
    const onPinSetup = vi.fn(() => events.push("setup"));
    const onClose = vi.fn(() => events.push("close"));
    const { onVerified } = mount({ onPinSetup, onClose });
    await savePin();
    await waitFor(() => expect(onPinSetup).toHaveBeenCalledTimes(1));
    expect(events).toEqual(["close", "setup"]);
    expect(onVerified).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("설정이 필요 없는 기존 확인 분기는 정상 verify 후에만 콜백을 실행한다", async () => {
    const { onVerified } = mount({ needsSetup: false });
    expect(screen.queryByLabelText("PIN 다시 입력")).toBeNull();
    verifyPin();
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/api/me/pin/verify", {
      method: "POST",
      body: { pin: "123456" },
    });
  });

  it("실제 useReauth의 대기 작업을 설정만으로 유실시키지 않고 확인 성공 후 재개한다", async () => {
    const task = vi
      .fn()
      .mockRejectedValueOnce(new ApiProblem(428, "pin_not_set", "PIN 필요"))
      .mockResolvedValue(undefined);
    function ReauthAction() {
      const { run, dialog } = useReauth();
      return createElement(
        "div",
        null,
        createElement("button", { type: "button", onClick: () => void run(task) }, "내보내기"),
        dialog,
      );
    }
    render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(ReauthAction),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "내보내기" }));
    await screen.findByLabelText("PIN 다시 입력");
    await savePin();
    await screen.findByLabelText("결재 PIN");
    expect(task).toHaveBeenCalledTimes(1);
    request.mockRejectedValueOnce(new ApiProblem(400, "pin_mismatch", "PIN 불일치"));
    verifyPin();
    await screen.findByRole("alert");
    expect(task).toHaveBeenCalledTimes(1);
    verifyPin();
    await waitFor(() => expect(task).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

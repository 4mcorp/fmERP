// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { LoadingState } from "./loading-state";

afterEach(() => cleanup());

describe("LoadingState", () => {
  it("기본 문구와 aria 상태를 실제 DOM에 렌더한다", () => {
    const { container, getByText } = render(createElement(LoadingState));
    const state = container.querySelector('[data-slot="loading-state"]');

    expect(getByText("불러오는 중…")).toBeTruthy();
    expect(state?.getAttribute("aria-busy")).toBe("true");
    expect(state?.getAttribute("aria-live")).toBe("polite");
  });

  it("문구와 inline variant를 렌더한다", () => {
    const { container, getByText } = render(
      createElement(LoadingState, { message: "목록 갱신 중", variant: "inline" }),
    );
    const state = container.querySelector('[data-slot="loading-state"]');

    expect(getByText("목록 갱신 중")).toBeTruthy();
    expect(state?.getAttribute("data-variant")).toBe("inline");
    expect(state?.className).toContain("items-center");
  });
});

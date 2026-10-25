// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryErrorState } from "./query-error-state";

afterEach(() => cleanup());

describe("QueryErrorState", () => {
  it("기본 문구와 alert role 및 다시 시도 버튼을 렌더한다", () => {
    const { getByRole, getByText } = render(createElement(QueryErrorState, { onRetry: () => {} }));

    expect(getByRole("alert")).toBeTruthy();
    expect(getByText("데이터를 불러오지 못했습니다")).toBeTruthy();
    expect(getByRole("button", { name: "다시 시도" })).toBeTruthy();
  });

  it("사용자 문구를 표시하고 버튼 클릭 시 onRetry를 호출한다", () => {
    const onRetry = vi.fn();
    const { getByRole, getByText } = render(
      createElement(QueryErrorState, { message: "연결에 실패했습니다", onRetry }),
    );

    expect(getByText("연결에 실패했습니다")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "다시 시도" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

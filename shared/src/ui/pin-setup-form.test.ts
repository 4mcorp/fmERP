import { afterEach, describe, expect, it, vi } from "vitest";
import { PIN_INPUT_PROPS } from "./pin-setup-form";

describe("PIN setup input policy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requires a numeric PIN between 6 and 12 digits", () => {
    expect(PIN_INPUT_PROPS.pattern).toBe("\\d{6,12}");
    expect(PIN_INPUT_PROPS.minLength).toBe(6);
    expect(PIN_INPUT_PROPS.maxLength).toBe(12);
    expect(PIN_INPUT_PROPS.required).toBe(true);
    expect(PIN_INPUT_PROPS.inputMode).toBe("numeric");
  });
});

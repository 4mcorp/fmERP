import { describe, expect, it } from "vitest";
import { type StatusKind, type StatusTone, statusTone } from "./status-badge";

const CASES: [StatusKind, string, StatusTone][] = [
  ["document", "DRAFT", "neutral"],
  ["document", "IN_PROGRESS", "info"],
  ["document", "ON_HOLD", "warning"],
  ["document", "WITHDRAWN", "muted"],
  ["document", "REJECTED", "danger"],
  ["document", "COMPLETED", "success"],
  ["document", "CANCELED", "muted"],
  ["document", "ARCHIVED", "neutral"],
  ["step", "PENDING", "muted"],
  ["step", "ACTIVE", "info"],
  ["step", "APPROVED", "success"],
  ["step", "REJECTED", "danger"],
  ["step", "HELD", "warning"],
  ["step", "SKIPPED", "neutral"],
  ["step", "DELEGATED", "accent"],
  ["step", "POST_PENDING", "warning"],
  ["step", "POST_APPROVED", "success"],
];

describe("statusTone", () => {
  it.each(CASES)("%s %s → %s", (kind, status, tone) => {
    expect(statusTone(kind, status)).toBe(tone);
  });

  it("알 수 없는 값은 neutral", () => {
    expect(statusTone("document", "UNKNOWN")).toBe("neutral");
    expect(statusTone("step", "toString")).toBe("neutral");
  });
});

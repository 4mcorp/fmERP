import diff from "microdiff";

/** 이름에 이 단어가 들어간 필드는 값 대신 마스킹한다 (PRD AUD-027, rules/security.md 2장) */
const SENSITIVE_KEY = /token|password|secret|pin|hash/i;
export const MASK = "***";

export type DiffEntry =
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string; oldValue: unknown }
  | { op: "change"; path: string; oldValue: unknown; value: unknown };

const isSensitive = (path: (string | number)[]) => path.some((p) => SENSITIVE_KEY.test(String(p)));
const mask = (path: (string | number)[], value: unknown) => (isSensitive(path) ? MASK : value);

/** 변경 전·후 객체의 차이를 감사 로그용으로 만든다. 민감 값은 마스킹한다. */
export function computeAuditDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): DiffEntry[] {
  return diff(before, after).map((d) => {
    const path = d.path.join(".");
    if (d.type === "CREATE") return { op: "add", path, value: mask(d.path, d.value) };
    if (d.type === "REMOVE") return { op: "remove", path, oldValue: mask(d.path, d.oldValue) };
    return {
      op: "change",
      path,
      oldValue: mask(d.path, d.oldValue),
      value: mask(d.path, d.value),
    };
  });
}

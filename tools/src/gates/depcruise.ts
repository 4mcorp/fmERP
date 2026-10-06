import { cruise } from "../cruise";
import type { Gate } from "./types";

/** `.dependency-cruiser.cjs`의 error 규칙 위반 */
export const depcruiseGate: Gate = {
  name: "depcruise",
  description: "dependency-cruiser 규칙 위반 (순환, 경계, 순수성 등)",
  async collect() {
    const { summary } = await cruise();
    return summary.violations
      .filter((v) => v.rule.severity === "error")
      .map((v) => {
        const via = v.cycle?.length
          ? [v.from, ...v.cycle.map((c) => c.name)].join(" -> ")
          : `${v.from} -> ${v.to}`;
        return `${v.rule.name}: ${via}`;
      });
  },
};

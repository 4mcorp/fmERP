import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const aggregate = resolve(".github/scripts/ci-result.py");

test.each([
  { required: true, result: "success", report: "pass", exit: 0 },
  { required: true, result: "skipped", report: "pass", exit: 1 },
  { required: true, result: "failure", report: "pass", exit: 1 },
  { required: true, result: "cancelled", report: "pass", exit: 1 },
  { required: true, result: "success", report: "missing", exit: 1 },
  { required: true, result: "success", report: "missing-gate", exit: 1 },
  { required: true, result: "success", report: "failed-gate", exit: 1 },
  { required: false, result: "skipped", report: "missing", exit: 0 },
  { required: false, result: "failure", report: "missing", exit: 1 },
])("check CLI: E2E required=$required result=$result report=$report → exit $exit", (scenario) => {
  const cwd = mkdtempSync(resolve(tmpdir(), "e2e-ci-"));
  try {
    const staticDir = resolve(cwd, "downloaded/quality-report-static");
    mkdirSync(staticDir, { recursive: true });
    writeFileSync(
      resolve(staticDir, "quality-report.json"),
      JSON.stringify({
        gates: ["biome", "typecheck", "arch-check", "arch-guard"].map((name) => ({
          name,
          pass: true,
          exitCode: 0,
        })),
      }),
    );
    if (scenario.report !== "missing") {
      const e2eDir = resolve(cwd, "downloaded/quality-report-e2e");
      mkdirSync(e2eDir, { recursive: true });
      writeFileSync(
        resolve(e2eDir, "quality-report.json"),
        JSON.stringify({
          gates:
            scenario.report === "missing-gate"
              ? []
              : [
                  {
                    name: "e2e",
                    pass: scenario.report !== "failed-gate",
                    exitCode: scenario.report === "failed-gate" ? 1 : 0,
                  },
                ],
        }),
      );
    }
    const needs = {
      scope: {
        result: "success",
        outputs: { features: "[]", core: "false", e2e: String(scenario.required) },
      },
      static: { result: "success" },
      "test-feature": { result: "skipped" },
      "test-core": { result: "skipped" },
      "test-integration": { result: "skipped" },
      e2e: { result: scenario.result },
    };
    const result = spawnSync("python3", ["-I", aggregate], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NEEDS_JSON: JSON.stringify(needs) },
    });
    expect(result.status, result.stderr + result.stdout).toBe(scenario.exit);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

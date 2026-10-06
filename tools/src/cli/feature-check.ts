// pnpm feature:check <기능> — 기능 격리 검사 (계획 7.3).
//  1) 그 기능의 tsconfig로 타입 검사하고, 컴파일 범위에 다른 기능·합성 루트·도구가 없는지 확인한다.
//  2) dependency-cruiser 규칙 위반 중 그 기능 폴더에 걸린 것이 0건인지 확인한다.
//  3) 그 기능의 단위·통합 테스트만 돌려 커버리지가 하한(tools/baselines/coverage.json) 이상인지 확인한다.
// 통합 테스트는 먼저 `pnpm env:up`이 필요하다. `--skip-tests`로 1)·2)만 돌릴 수 있다.
import fs from "node:fs";
import path from "node:path";
import { cruise } from "../cruise";
import {
  type CoverageFloor,
  coverageShortfalls,
  isolationLeaks,
  listedFilesOf,
} from "../feature-check";
import { BASELINE_DIR, ROOT, readJson, runNode } from "../root";

const [feature] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const skipTests = process.argv.includes("--skip-tests");
if (!feature || !fs.existsSync(path.join(ROOT, "features", feature))) {
  console.error(
    "사용법: pnpm feature:check <기능 이름> [--skip-tests]  (features/ 아래 폴더 이름)",
  );
  process.exit(2);
}

let failed = false;
const fail = (message: string) => {
  failed = true;
  console.error(`  ✗ ${message}`);
};

// 1) 타입 검사 + 컴파일 범위
console.log(`[${feature}] 타입 검사와 컴파일 범위`);
const tsc = await runNode("node_modules/typescript/bin/tsc", [
  "-p",
  `features/${feature}/tsconfig.json`,
  "--noEmit",
  "--listFiles",
]);
const typeErrors = tsc.stdout.split(/\r?\n/).filter((l) => /error TS\d+/.test(l));
if (tsc.code !== 0 || typeErrors.length > 0) {
  fail(`타입 오류 ${typeErrors.length}건\n      ${typeErrors.slice(0, 10).join("\n      ")}`);
}
const leaks = isolationLeaks(listedFilesOf(tsc.stdout), feature, ROOT);
if (leaks.length > 0)
  fail(`다른 기능·합성 루트·도구가 컴파일 범위에 있습니다:\n      ${leaks.join("\n      ")}`);

// 2) 의존 규칙
console.log(`[${feature}] 의존 규칙 위반`);
const { summary } = await cruise();
const own = `features/${feature}/`;
const violations = summary.violations.filter(
  (v) => v.rule.severity === "error" && (v.from.startsWith(own) || v.to.startsWith(own)),
);
for (const v of violations) fail(`${v.rule.name}: ${v.from} -> ${v.to}`);

// 3) 테스트 + 커버리지 하한
if (!skipTests) {
  console.log(`[${feature}] 단위·통합 테스트와 커버리지`);
  const floors = readJson<Record<string, CoverageFloor>>(
    path.join(BASELINE_DIR, "coverage.json"),
    {},
  );
  const floor = floors[feature];
  if (!floor) fail(`tools/baselines/coverage.json에 ${feature}의 하한이 없습니다`);
  const reportDir = `artifacts/coverage/${feature}`;
  const vitest = await runNode("node_modules/vitest/vitest.mjs", [
    "run",
    "--project",
    "unit",
    "--project",
    "integration",
    `features/${feature}/`,
    "--coverage",
    "--coverage.provider=v8",
    `--coverage.include=features/${feature}/src/**`,
    "--coverage.reporter=json-summary",
    `--coverage.reportsDirectory=${reportDir}`,
  ]);
  if (vitest.code !== 0) fail(`테스트 실패\n${vitest.stdout.split("\n").slice(-30).join("\n")}`);
  const summaryFile = path.join(ROOT, reportDir, "coverage-summary.json");
  if (floor && fs.existsSync(summaryFile)) {
    const total = (
      JSON.parse(fs.readFileSync(summaryFile, "utf8")) as {
        total: Record<keyof CoverageFloor, { pct: number }>;
      }
    ).total;
    const measured: CoverageFloor = {
      lines: total.lines.pct,
      statements: total.statements.pct,
      functions: total.functions.pct,
      branches: total.branches.pct,
    };
    console.log(`  커버리지 ${JSON.stringify(measured)} (하한 ${JSON.stringify(floor)})`);
    for (const s of coverageShortfalls(measured, floor)) {
      fail(`커버리지 ${s.metric} ${s.measured}% < 하한 ${s.floor}%`);
    }
  } else if (floor) {
    fail("커버리지 요약 파일이 없습니다");
  }
}

if (failed) {
  console.error(`\nfeature:check ${feature} 실패`);
  process.exit(1);
}
console.log(`\nfeature:check ${feature} 통과`);

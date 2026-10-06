// pnpm arch:guard — 규칙 약화 감지.
// 한도(tools/baselines/limits.json)가 기준 커밋보다 늘었거나 게이트가 사라졌으면 실패한다.
// 기준 커밋은 GUARD_BASE_REF (CI: PR의 대상 브랜치, push: 이전 커밋). 없으면 HEAD(작업 트리의 미커밋 변경만 비교).
// 한도를 올려야 하는 정말 드문 경우는 사람이 PR에서 설명하고 CODEOWNERS 승인을 받는다.

import fs from "node:fs";
import path from "node:path";
import { type CoverageFloor, coverageFloorRegressions } from "../feature-check";
import { limitRegressions, readLimits } from "../ratchet";
import { git, ROOT } from "../root";

const baseRef = process.env.GUARD_BASE_REF || "HEAD";
const FILE = "tools/baselines/limits.json";

let baseText: string;
try {
  baseText = await git(["show", `${baseRef}:${FILE}`]);
} catch {
  console.log(`guard: ${baseRef}에 ${FILE}이 없어 비교를 건너뜁니다 (처음 만드는 변경)`);
  process.exit(0);
}

const base = JSON.parse(baseText) as Record<string, number>;
const current = readLimits();

const problems = limitRegressions(base, current);

// 기능별 커버리지 하한도 낮출 수 없다
const COVERAGE_FILE = "tools/baselines/coverage.json";
try {
  const baseCoverage = JSON.parse(await git(["show", `${baseRef}:${COVERAGE_FILE}`])) as Record<
    string,
    CoverageFloor
  >;
  const currentCoverage = JSON.parse(
    fs.readFileSync(path.join(ROOT, COVERAGE_FILE), "utf8"),
  ) as Record<string, CoverageFloor>;
  problems.push(...coverageFloorRegressions(baseCoverage, currentCoverage));
} catch {
  // 기준 커밋에 하한 파일이 없으면(처음 만드는 변경) 비교할 것이 없다
}
if (problems.length > 0) {
  for (const problem of problems) console.error(`  ✗ ${problem}. 위반을 고치세요`);
  console.error(`\narch:guard 실패 (기준: ${baseRef})`);
  process.exit(1);
}
console.log(
  `guard: 한도가 ${baseRef}보다 늘지 않았습니다 (${Object.keys(current).length}개 게이트)`,
);

// dependency-cruiser를 한 번 돌려 결과 JSON을 돌려준다. 결합 측정과 규칙 위반 수집이 같은 결과를 쓴다.
import fs from "node:fs";
import path from "node:path";
import { ROOT, runNode } from "./root";

interface CruiseDependency {
  module: string;
  resolved: string;
  dependencyTypes: string[];
  circular?: boolean;
  cycle?: { name: string; dependencyTypes: string[] }[];
}
export interface CruiseModule {
  source: string;
  dependencies: CruiseDependency[];
}
interface CruiseViolation {
  type: string;
  from: string;
  to: string;
  rule: { severity: string; name: string };
  cycle?: { name: string }[];
}
export interface CruiseResult {
  modules: CruiseModule[];
  summary: {
    violations: CruiseViolation[];
    totalCruised: number;
    totalDependenciesCruised: number;
  };
}

/** 검사 대상 폴더. 없는 폴더는 건너뛴다(`features/`, `shared/`는 이전 후에 생긴다) */
const TARGETS = ["apps", "packages", "tools", "features", "shared"];

let cached: Promise<CruiseResult> | null = null;

export function cruise(): Promise<CruiseResult> {
  cached ??= (async () => {
    const targets = TARGETS.filter((t) => fs.existsSync(path.join(ROOT, t)));
    const { stdout, stderr, code } = await runNode(
      "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs",
      [...targets, "--config", ".dependency-cruiser.cjs", "--output-type", "json"],
    );
    // 규칙 위반이 있으면 종료 코드가 0이 아니지만 JSON은 정상이다. JSON이 없으면 도구 오류다
    if (!stdout.trim().startsWith("{")) {
      throw new Error(`dependency-cruiser 실행 실패 (종료 코드 ${code}): ${stderr.slice(0, 500)}`);
    }
    return JSON.parse(stdout) as CruiseResult;
  })();
  return cached;
}

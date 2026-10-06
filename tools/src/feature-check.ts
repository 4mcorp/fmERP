// 기능 격리 검사의 순수한 부분 (계획 7.3). 실행은 cli/feature-check.ts가 한다.
import path from "node:path";

/** 커버리지 하한. 래칫처럼 낮추지 않는다 (tools/baselines/coverage.json) */
export interface CoverageFloor {
  lines: number;
  statements: number;
  functions: number;
  branches: number;
}

/**
 * `tsc --listFiles` 출력에서 이 기능이 "자기 폴더 + 공통 영역"을 벗어나 끌어온 파일을 찾는다.
 * 다른 기능 폴더(`features/<다른 것>/`), 합성 루트(`apps/`), 도구(`tools/`)가 컴파일 범위에 들어오면 격리가 깨진 것이다.
 * (`packages/*`는 이전 중에는 아직 기능 코드가 남은 공통 영역으로 취급한다. 이전이 끝나면 이 검사가 더 엄격해진다.)
 */
export function isolationLeaks(listedFiles: string[], feature: string, root: string): string[] {
  const own = `features/${feature}/`;
  return listedFiles
    .map((f) => path.relative(root, f).split(path.sep).join("/"))
    .filter((rel) => !rel.startsWith("..") && !rel.includes("node_modules/"))
    .filter(
      (rel) => /^(apps|tools)\//.test(rel) || (/^features\//.test(rel) && !rel.startsWith(own)),
    );
}

/** `tsc --listFiles`의 파일 목록 줄(절대 경로)만 걸러 낸다. 오류 줄은 제외한다 */
export function listedFilesOf(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        (path.win32.isAbsolute(l) || path.posix.isAbsolute(l)) && /\.(?:ts|tsx|mts|cts)$/.test(l),
    );
}

/** 측정한 커버리지가 하한 아래인 지표 */
export function coverageShortfalls(
  measured: CoverageFloor,
  floor: CoverageFloor,
): { metric: keyof CoverageFloor; measured: number; floor: number }[] {
  return (Object.keys(floor) as (keyof CoverageFloor)[])
    .filter((metric) => measured[metric] < floor[metric])
    .map((metric) => ({ metric, measured: measured[metric], floor: floor[metric] }));
}

/** 기준 커밋보다 낮아졌거나 사라진 커버리지 하한 (규칙 약화 감지). 새 기능의 하한 추가는 허용한다 */
export function coverageFloorRegressions(
  base: Record<string, CoverageFloor>,
  current: Record<string, CoverageFloor>,
): string[] {
  const problems: string[] = [];
  for (const [feature, floor] of Object.entries(base)) {
    const now = current[feature];
    if (!now) {
      problems.push(`${feature}: 커버리지 하한이 사라졌습니다`);
      continue;
    }
    for (const metric of Object.keys(floor) as (keyof CoverageFloor)[]) {
      if (now[metric] < floor[metric]) {
        problems.push(
          `${feature}: 커버리지 하한 ${metric}이 ${floor[metric]} → ${now[metric]}로 낮아졌습니다`,
        );
      }
    }
  }
  return problems;
}

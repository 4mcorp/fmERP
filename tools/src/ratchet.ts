// 래칫: 기준선 파일·한도 파일 읽기/쓰기와 비교 (규칙 설명은 gates/types.ts)
import fs from "node:fs";
import path from "node:path";
import { BASELINE_DIR, readJson } from "./root";

const LIMITS_FILE = path.join(BASELINE_DIR, "limits.json");

export type Limits = Record<string, number>;

export const readLimits = (): Limits => readJson<Limits>(LIMITS_FILE, {});

export function writeLimits(limits: Limits): void {
  const sorted = Object.fromEntries(Object.entries(limits).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(LIMITS_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
}

const baselineFile = (name: string) => path.join(BASELINE_DIR, `${name}.txt`);

/** 정렬·중복 제거한 키 목록 */
export const normalize = (keys: string[]): string[] => [...new Set(keys)].sort();

export function readBaseline(name: string): string[] {
  try {
    return fs
      .readFileSync(baselineFile(name), "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

export function removeBaseline(name: string): void {
  fs.rmSync(baselineFile(name), { force: true });
}

export function writeBaseline(name: string, keys: string[]): void {
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  fs.writeFileSync(baselineFile(name), keys.length > 0 ? `${keys.join("\n")}\n` : "");
}

interface Comparison {
  added: string[];
  removed: string[];
}

function compare(baseline: string[], current: string[]): Comparison {
  const base = new Set(baseline);
  const cur = new Set(current);
  return {
    added: current.filter((k) => !base.has(k)),
    removed: baseline.filter((k) => !cur.has(k)),
  };
}

export interface Evaluation {
  /** 실패 사유. 비어 있으면 통과 */
  errors: string[];
  added: string[];
  removed: string[];
}

/**
 * 엄격 게이트의 평가 (순수 함수): 위반이 하나라도 있으면 실패하고, 남아 있는 기준선 파일이나 0이 아닌 한도도 실패다.
 * 기준선을 두는 방식으로 위반을 숨길 수 없다.
 */
export function evaluateStrict(
  name: string,
  baseline: string[],
  current: string[],
  limit: number | undefined,
): Evaluation {
  const errors: string[] = [];
  if (current.length > 0)
    errors.push(`${name}: 위반 ${current.length}건 (엄격 게이트: 0건이어야 합니다. 고치세요)`);
  if (baseline.length > 0)
    errors.push(`${name}: 엄격 게이트에 기준선 파일이 있습니다. 삭제하고 위반을 고치세요`);
  if (limit !== 0) errors.push(`${name}: 한도는 0으로 고정입니다 (현재 ${limit ?? "없음"})`);
  return { errors, added: current, removed: [] };
}

/** 한 게이트의 현재 위반을 기준선·한도와 비교한다 (순수 함수) */
export function evaluate(
  name: string,
  baseline: string[],
  current: string[],
  limit: number | undefined,
): Evaluation {
  const { added, removed } = compare(baseline, current);
  const errors: string[] = [];
  if (limit === undefined) errors.push(`${name}: 한도가 없습니다 (pnpm arch:baseline --init)`);
  else if (current.length > limit) {
    errors.push(`${name}: 위반 ${current.length}건이 한도 ${limit}건을 넘었습니다`);
  }
  if (added.length > 0) {
    errors.push(`${name}: 새 위반 ${added.length}건 (기준선에 넣지 말고 고치세요)`);
  }
  if (removed.length > 0) {
    errors.push(
      `${name}: 위반 ${removed.length}건이 사라졌습니다. 줄어든 기준선을 커밋하세요 → pnpm arch:baseline`,
    );
  }
  return { errors, added, removed };
}

/** 한도가 기준보다 늘었거나 게이트가 사라졌는지 (순수 함수). 규칙 약화 감지에 쓴다 */
export function limitRegressions(base: Limits, current: Limits): string[] {
  const problems: string[] = [];
  for (const [name, limit] of Object.entries(base)) {
    const now = current[name];
    if (now === undefined) problems.push(`${name}: 게이트의 한도가 사라졌습니다 (기준: ${limit})`);
    else if (now > limit) problems.push(`${name}: 한도가 ${limit} → ${now}로 늘었습니다`);
  }
  return problems;
}

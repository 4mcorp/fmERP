// 린트·타입 검사 억제 주석의 수. 에이전트가 검사를 끄는 것으로 문제를 "해결"하지 못하게 늘어나는 것을 막는다.
import fs from "node:fs";
import path from "node:path";
import { git, ROOT } from "../root";
import type { Gate } from "./types";

// 이 파일 자신에는 아래 문자열이 정규식으로 들어 있으므로 검사에서 뺀다
const SELF = "tools/src/gates/suppressions.ts";

const KINDS: [string, RegExp][] = [
  ["biome-ignore", /biome-ignore/g],
  ["ts-ignore", /@ts-ignore/g],
  ["ts-expect-error", /@ts-expect-error/g],
  ["ts-nocheck", /@ts-nocheck/g],
  ["eslint-disable", /eslint-disable/g],
  ["coverage-ignore", /(?:istanbul|c8|v8) ignore/g],
];

const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

export const suppressionsGate: Gate = {
  name: "suppressions",
  description: "린트·타입 검사 억제 주석 (파일·종류별 개수)",
  async collect() {
    const files = (await git(["ls-files", "--cached", "--others", "--exclude-standard"]))
      .split("\n")
      .filter(
        (f) =>
          SOURCE.test(f) &&
          f !== SELF &&
          !f.startsWith(".claude/skills/") &&
          fs.existsSync(path.join(ROOT, f)),
      );
    const keys: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      for (const [kind, re] of KINDS) {
        const count = text.match(re)?.length ?? 0;
        if (count > 0) keys.push(`${file}:${kind}:${count}`);
      }
    }
    return keys;
  },
};

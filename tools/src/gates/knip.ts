import { runNode } from "../root";
import type { Gate } from "./types";

type Issue = { file: string } & Record<string, unknown>;

/** Knip이 보고하는 항목 종류 (이름이 있는 것만). 키는 `종류:파일:이름` */
const CATEGORIES = [
  "files",
  "dependencies",
  "devDependencies",
  "optionalPeerDependencies",
  "unlisted",
  "binaries",
  "unresolved",
  "exports",
  "types",
  "enumMembers",
  "namespaceMembers",
  "duplicates",
] as const;

export const knipGate: Gate = {
  name: "knip",
  strict: true,
  description: "사용되지 않는 파일·export·의존성, 선언되지 않은 의존성 (Knip)",
  async collect() {
    const { stdout, stderr } = await runNode("node_modules/knip/bin/knip.js", [
      "--reporter",
      "json",
      "--no-progress",
      "--no-exit-code",
    ]);
    if (!stdout.trim().startsWith("{")) throw new Error(`knip 실행 실패: ${stderr.slice(0, 500)}`);
    const { issues } = JSON.parse(stdout) as { issues: Issue[] };
    const keys: string[] = [];
    for (const issue of issues) {
      for (const category of CATEGORIES) {
        const items = issue[category];
        if (!Array.isArray(items)) continue;
        for (const item of items as { name?: string; symbols?: { symbol: string }[] }[]) {
          // 중복 export는 이름이 `a|b` 형태로 합쳐져 온다
          keys.push(`${category}:${issue.file}:${item.name ?? JSON.stringify(item)}`);
        }
      }
    }
    return keys;
  },
};

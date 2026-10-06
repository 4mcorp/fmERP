// pnpm arch:move --map <옛경로>=<새경로> [--map …] [--dir-map <옛폴더>=<새폴더>] [--dry]
// 파일을 `git mv`로 옮기고 저장소 전체의 import 지정자를 새 위치에 맞게 고친다.
// 옮긴 뒤에는 Biome 정렬을 돌리고 tools/src/feature-assignment.ts의 규칙을 직접 맞춘다.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { applyMoves, planMoves } from "../move";
import { git, ROOT } from "../root";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const pairs = (flag: string) =>
  args.flatMap((a, i) => (args[i - 1] === flag ? [a.split("=") as [string, string]] : []));

const moves = new Map<string, string>(pairs("--map"));
for (const [fromDir, toDir] of pairs("--dir-map")) {
  const walk = (dir: string): string[] =>
    fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = `${dir}/${e.name}`;
      return e.isDirectory() ? walk(rel) : [rel];
    });
  for (const file of walk(fromDir)) moves.set(file, `${toDir}${file.slice(fromDir.length)}`);
}
if (moves.size === 0) {
  console.error("사용법: arch:move --map 옛=새 [--map …] [--dir-map 옛폴더=새폴더] [--dry]");
  process.exit(2);
}

const files = (await git(["ls-files", "--cached", "--others", "--exclude-standard"]))
  .split("\n")
  .filter((f) => /\.(ts|tsx|mts|cts)$/.test(f) && fs.existsSync(path.join(ROOT, f)));

if (dry) {
  const plan = planMoves(ROOT, moves, files);
  console.log(
    `이동 ${moves.size}개, 지정자 수정 ${plan.edits.length}곳 (${new Set(plan.edits.map((e) => e.file)).size}개 파일)`,
  );
  for (const w of plan.warnings) console.warn(`  경고: ${w}`);
  process.exit(0);
}

const result = applyMoves(ROOT, moves, files, (from, to) => {
  execFileSync("git", ["mv", from, to], { cwd: ROOT, stdio: "inherit" });
});
for (const w of result.warnings) console.warn(`  경고: ${w}`);
console.log(`이동 ${moves.size}개, 수정한 파일 ${result.changed.length}개`);
execFileSync(
  process.execPath,
  [path.join(ROOT, "node_modules/@biomejs/biome/bin/biome"), "check", "--write", ...result.changed],
  {
    cwd: ROOT,
    stdio: "inherit",
  },
);

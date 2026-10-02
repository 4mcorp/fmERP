// PostToolUse hook: Claude가 편집한 파일 하나만 Biome로 포맷한다 (결정 P4).
// Windows에서 셸 없이 .cmd를 실행하면 실패하므로 Biome의 Node 런처를 node로 직접 실행한다
// (docs/ts/2026-10-03-windows-npx-mcp-enoent.md).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const FORMATTABLE = /\.(?:[cm]?[jt]sx?|json|jsonc|css)$/;

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0); // 포맷은 보조 기능이므로 입력 문제로 작업을 막지 않는다
}
const filePath = input.tool_input?.file_path;
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
const biome = path.join(projectDir, "node_modules", "@biomejs", "biome", "bin", "biome");

const relative = filePath ? path.relative(projectDir, filePath) : "";
const skip =
  !filePath ||
  !FORMATTABLE.test(filePath) ||
  relative.startsWith("..") ||
  relative.startsWith(path.join(".claude", "skills")) ||
  !existsSync(biome);

if (!skip) {
  // Biome는 Windows 역슬래시 절대 경로를 매칭하지 못하므로 프로젝트 기준 상대 경로(/)로 넘긴다
  const target = relative.split(path.sep).join("/");
  spawnSync(process.execPath, [biome, "format", "--write", target], {
    cwd: projectDir,
    stdio: "pipe", // "ignore"로 두면 Windows에서 Biome 실행 파일이 조용히 실패한다
  });
}
process.exit(0);

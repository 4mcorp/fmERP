// tsx tools/src/cli/run-gate.ts <이름> -- <명령...>
// 명령을 그대로 실행(출력·종료 코드 유지)하면서 결과를 artifacts/gates/<이름>.json에 남긴다. 품질 리포트의 입력이다.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ARTIFACT_DIR, ROOT } from "../root";

const sep = process.argv.indexOf("--");
const name = process.argv[2];
const command = sep >= 0 ? process.argv.slice(sep + 1) : [];
const program = command[0];
if (!name || sep < 0 || !program) {
  console.error("사용법: run-gate.ts <이름> -- <명령...>");
  process.exit(2);
}

const startedAt = new Date();
const code = await new Promise<number>((resolve) => {
  const child = spawn(program, command.slice(1), {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("error", () => resolve(127));
  child.on("close", (c) => resolve(c ?? 1));
});

const dir = path.join(ARTIFACT_DIR, "gates");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(dir, `${name}.json`),
  `${JSON.stringify(
    {
      name,
      command: command.join(" "),
      exitCode: code,
      pass: code === 0,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
    },
    null,
    2,
  )}\n`,
);
process.exit(code);

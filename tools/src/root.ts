import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const BASELINE_DIR = path.join(ROOT, "tools", "baselines");
export const ARTIFACT_DIR = path.join(ROOT, "artifacts");

/** node로 실행할 수 있는 스크립트를 돌리고 stdout을 돌려준다. 종료 코드가 0이 아니어도 출력은 돌려준다 */
export async function runNode(
  script: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [path.join(ROOT, script), ...args],
      { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 },
    );
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      code: typeof e.code === "number" ? e.code : 1,
    };
  }
}

export async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

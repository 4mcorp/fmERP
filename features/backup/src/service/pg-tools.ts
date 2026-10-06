// pg_dump·pg_restore 실행 (M7). 명령은 환경 변수로 바꿀 수 있다:
//  - 운영: worker 이미지의 `pg_dump`(postgresql-client-18)
//  - 개발 PC 테스트: DB 컨테이너 안에서 실행 `docker exec -i -e PGPASSWORD=… <컨테이너> pg_dump`
import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

export interface PgToolConfig {
  /** 실행 명령 (공백으로 나눈 인자 포함. 예: `docker exec -i -e PGPASSWORD=x db pg_dump`) */
  command: string;
  /** 도구가 접속할 DB URL. 컨테이너 안에서 실행하면 그 안에서 보이는 주소여야 한다 */
  url: string;
}

function splitCommand(command: string): { file: string; args: string[] } {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  const [file, ...args] = parts;
  if (!file) throw new Error("실행 명령이 비어 있습니다");
  return { file, args };
}

/** 접속 URL을 도구 인자로 풀고, 비밀번호는 인자가 아니라 PGPASSWORD 환경 변수로 넘긴다 */
function connectionArgs(url: string): { args: string[]; env: Record<string, string> } {
  const u = new URL(url);
  const env: Record<string, string> = {};
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  return {
    args: [
      "-h",
      u.hostname,
      "-p",
      u.port || "5432",
      "-U",
      decodeURIComponent(u.username),
      "-d",
      u.pathname.replace(/^\//, ""),
    ],
    env,
  };
}

/** 오류 문구에 비밀이 섞이지 않게 길이를 줄인다 */
export const clip = (text: string, max = 1500) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

export interface RunningTool {
  child: ChildProcessByStdio<null | Writable, Readable, Readable>;
  stdout: Readable;
  /** 프로세스가 끝나면 종료 코드와 stderr를 돌려준다 */
  done: Promise<{ code: number | null; stderr: string }>;
}

/** 도구를 실행한다. 표준 출력은 스트림으로 흘려보내고 표준 오류는 모아 둔다 */
export function runTool(
  config: PgToolConfig,
  toolArgs: string[],
  options: { stdin?: boolean; extraEnv?: Record<string, string> } = {},
): RunningTool {
  const { file, args } = splitCommand(config.command);
  const conn = connectionArgs(config.url);
  const child = spawn(file, [...args, ...conn.args, ...toolArgs], {
    env: { ...process.env, ...conn.env, ...options.extraEnv },
    stdio: [options.stdin ? "pipe" : "ignore", "pipe", "pipe"],
  }) as ChildProcessByStdio<null | Writable, Readable, Readable>;
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d: string) => {
    if (stderr.length < 20_000) stderr += d;
  });
  const done = new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
  return { child, stdout: child.stdout, done };
}

/** 도구 버전 문자열 (예: `pg_dump (PostgreSQL) 18.1`). 접속하지 않으므로 URL 인자는 붙이지 않는다 */
export async function toolVersion(command: string): Promise<string> {
  const { file, args } = splitCommand(command);
  const child = spawn(file, [...args, "--version"], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d: string) => {
    out += d;
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (code !== 0) throw new Error(`${command} --version 실패 (종료 코드 ${code})`);
  return out.trim();
}

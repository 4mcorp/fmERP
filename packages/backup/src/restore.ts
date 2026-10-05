// DB 복원 (PRD BAK-010 ①, M7 plan 5절). 운영자가 서버에서 CLI로 실행한다.
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { clip, type PgToolConfig, runTool } from "./pg-tools";

/**
 * 복호화된 덤프(`pg_dump -Fc`) 스트림을 `pg_restore`에 흘려 넣는다. 오류가 나면 바로 멈춘다(`--exit-on-error`).
 * 대상 DB가 비어 있는지는 호출하는 쪽(CLI)이 확인한다.
 */
export async function restoreDump(config: PgToolConfig, plain: Readable): Promise<void> {
  const tool = runTool(config, ["--no-owner", "--no-acl", "--exit-on-error"], { stdin: true });
  tool.stdout.resume();
  const stdin = tool.child.stdin;
  if (!stdin) throw new Error("pg_restore 표준 입력을 열 수 없습니다");
  // pg_restore가 먼저 끝나면(오류) 쓰기가 EPIPE로 끊기므로, 그때는 종료 코드와 오류 문구를 우선해서 알린다
  const piped = pipeline(plain, stdin).catch((error: unknown) => error);
  const { code, stderr } = await tool.done;
  const pipeError = await piped;
  if (code !== 0) throw new Error(`pg_restore 실패 (종료 코드 ${code}): ${clip(stderr)}`);
  if (pipeError) throw pipeError instanceof Error ? pipeError : new Error(String(pipeError));
}

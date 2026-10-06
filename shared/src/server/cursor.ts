// 목록 쪽 나누기용 커서 (문서함·감사 로그 공통)
import { ServiceError } from "./errors";

/**
 * 커서의 시각은 DB가 준 **마이크로초 문자열**을 그대로 쓴다. JS Date는 밀리초까지만 담아서, 같은 밀리초 안에 만들어진
 * 문서가 다음 쪽에서 빠지거나 겹친다.
 */
const CURSOR_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const encodeCursor = (at: string, id: string) =>
  Buffer.from(`${at}|${id}`).toString("base64url");

export function decodeCursor(cursor: string): { at: string; id: string } {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  if (!at || !id || !CURSOR_AT.test(at) || !UUID.test(id)) {
    throw new ServiceError("validation_failed", "잘못된 커서입니다");
  }
  return { at, id };
}

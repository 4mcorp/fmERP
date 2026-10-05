// 로그·상태 화면에 남길 오류 문구. DB 오류 메시지에는 SQL 매개변수(토큰 해시, 대화 번호)가 들어 있고,
// 네트워크 오류에는 요청 주소(봇 토큰)가 들어 있을 수 있어 필요한 부분만 남긴다.
import { TelegramApiError } from "./telegram-api";

export function safeErrorText(error: unknown): string {
  if (error instanceof TelegramApiError) return error.message;
  if (!(error instanceof Error)) return "알 수 없는 오류";
  const code =
    (error as { cause?: { code?: string }; code?: string }).cause?.code ??
    (error as { code?: string }).code;
  const firstLine = (error.message.split("\n")[0] ?? "").slice(0, 120);
  // 드리즐의 "Failed query: <SQL>"은 SQL 전문과 매개변수가 따라오므로 버린다
  const message = /^Failed query/i.test(firstLine) ? "DB 쿼리 실패" : firstLine;
  return `${error.name}${code ? ` (${code})` : ""}: ${message}`;
}

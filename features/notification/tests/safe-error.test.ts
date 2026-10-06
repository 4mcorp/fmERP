import { describe, expect, it } from "vitest";
import { safeErrorText } from "../src/service/safe-error";
import { TelegramApiError } from "../src/service/telegram-api";

describe("오류 문구 정리", () => {
  it("DB 쿼리 오류는 SQL·매개변수를 버리고 코드만 남긴다", () => {
    const error = Object.assign(
      new Error(
        "Failed query: update telegram_link_token set used_at = $1 where hash = $2\nparams: 2026,abcdef",
      ),
      { cause: { code: "23505" } },
    );
    const text = safeErrorText(error);
    expect(text).toContain("23505");
    expect(text).not.toContain("abcdef");
    expect(text).not.toContain("telegram_link_token");
  });

  it("텔레그램 API 오류는 메서드·상태만 담긴 메시지를 그대로 쓰고, 일반 오류는 첫 줄만 남긴다", () => {
    expect(safeErrorText(new TelegramApiError("sendMessage", 429, "Too Many Requests"))).toContain(
      "sendMessage",
    );
    expect(safeErrorText(new Error("첫 줄\n둘째 줄 비밀"))).not.toContain("비밀");
    expect(safeErrorText("문자열")).toBe("알 수 없는 오류");
  });
});

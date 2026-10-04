import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 폴더의 woff2 글꼴을 `@font-face` CSS(data URI)로 만든다. 파일 이름의 `Pretendard-Regular.woff2`·`Pretendard-Bold.woff2`
 * 같은 끝부분(Regular/Medium/SemiBold/Bold)으로 굵기를 정한다. 폴더가 없거나 비어 있으면 빈 문자열을 돌려주고,
 * PDF는 시스템 글꼴(Noto Sans CJK KR·맑은 고딕 등)로 그려진다.
 */
const WEIGHTS: Record<string, number> = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

export function loadFontCss(dir: string): string {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".woff2"));
  } catch {
    return "";
  }
  return files
    .map((file) => {
      const key =
        file
          .replace(/\.woff2$/i, "")
          .split(/[-_]/)
          .pop()
          ?.toLowerCase() ?? "regular";
      const weight = WEIGHTS[key] ?? 400;
      const base64 = readFileSync(join(dir, file)).toString("base64");
      return `@font-face{font-family:"Pretendard";font-weight:${weight};src:url(data:font/woff2;base64,${base64}) format("woff2");}`;
    })
    .join("\n");
}

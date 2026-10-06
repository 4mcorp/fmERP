import { type DocNumberContext, renderForParse } from "@fmerp/core";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 일련번호 자리를 표시하는 글자. 문서번호 규칙에는 나올 수 없는 제어 문자다 */
const MARKER = "\u0000";

/**
 * 렌더링된 문서번호에서 일련번호를 되읽는다. 규칙의 나머지 부분(사업자·부서·양식 코드, 연·월)을 `ctx`로 다시 렌더링해
 * 앞뒤 글자가 정확히 같을 때만 숫자를 돌려주고, 다른 시리즈(다른 규칙·다른 해)의 번호면 null이다.
 * DB를 잃은 뒤 문서번호 시리즈를 이미 쓴 번호 이후로 맞추는 데 쓴다 (색인 재구성, PRD BAK-010).
 */
export function parseDocNumberSeq(
  rule: string,
  ctx: DocNumberContext,
  docNo: string,
): number | null {
  const parts = renderForParse(rule, ctx, MARKER).split(MARKER);
  if (parts.length !== 2) return null;
  const [before, after] = parts as [string, string];
  const pattern = new RegExp(`^${escapeRegExp(before)}(\\d+)${escapeRegExp(after)}$`);
  const m = pattern.exec(docNo);
  return m?.[1] ? Number(m[1]) : null;
}

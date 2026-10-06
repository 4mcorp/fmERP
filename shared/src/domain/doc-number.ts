/** 문서번호 규칙 (PRD APV-060·061). 순수 함수. 연·월은 서울 시간 기준이다 (NFR-U05) */

export type ResetCycle = "year" | "month" | "none";

export interface DocNumberContext {
  businessCode: string;
  departmentCode: string;
  formCode: string;
  date: Date;
}

const TOKEN = /\{([^{}:]+)(?::([^{}]*))?\}/g;
const SIMPLE = new Set(["사업자코드", "부서코드", "양식코드", "YYYY", "YY", "MM"]);
const KST_OFFSET_MS = 9 * 3_600_000;

export type RuleCheck = { ok: true } | { ok: false; reason: string };

export function validateDocNumberRule(rule: string): RuleCheck {
  if (rule.length === 0 || rule.length > 100)
    return { ok: false, reason: "규칙은 1~100자여야 합니다" };
  let seqCount = 0;
  for (const m of rule.matchAll(TOKEN)) {
    const [, name, arg] = m;
    if (name === "SEQ") {
      seqCount += 1;
      const n = arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : Number.NaN;
      if (!(n >= 1 && n <= 10)) return { ok: false, reason: "{SEQ:n}의 n은 1~10이어야 합니다" };
    } else if (!SIMPLE.has(name ?? "") || arg !== undefined) {
      return { ok: false, reason: `알 수 없는 토큰입니다: ${m[0]}` };
    }
  }
  if (seqCount !== 1) return { ok: false, reason: "{SEQ:n}이 정확히 하나 필요합니다" };
  return { ok: true };
}

function kstParts(date: Date) {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

function render(rule: string, ctx: DocNumberContext, seq: (digits: number) => string): string {
  const { year, month } = kstParts(ctx.date);
  return rule.replace(TOKEN, (whole, name: string, arg?: string) => {
    switch (name) {
      case "사업자코드":
        return ctx.businessCode;
      case "부서코드":
        return ctx.departmentCode;
      case "양식코드":
        return ctx.formCode;
      case "YYYY":
        return String(year);
      case "YY":
        return String(year % 100).padStart(2, "0");
      case "MM":
        return String(month).padStart(2, "0");
      case "SEQ":
        return seq(Number(arg));
      default:
        return whole;
    }
  });
}

export function renderDocNumber(rule: string, ctx: DocNumberContext & { seq: number }): string {
  return render(rule, ctx, (digits) => String(ctx.seq).padStart(digits, "0"));
}

/**
 * 순번이 이어지는 시리즈를 가리키는 키. 일련번호를 뺀 렌더링 결과 + 초기화 기간이다.
 * 같은 키에서만 번호가 이어지고, 부서·양식 코드가 다르면 별도 시리즈가 된다.
 */
export function seriesKey(rule: string, ctx: DocNumberContext, cycle: ResetCycle): string {
  const { year, month } = kstParts(ctx.date);
  const period =
    cycle === "year"
      ? String(year)
      : cycle === "month"
        ? `${year}-${String(month).padStart(2, "0")}`
        : "-";
  return `${render(rule, ctx, () => "#")}|${period}`;
}

/** 일련번호 자리를 `marker`로 둔 렌더링 (렌더링한 번호에서 순번을 되읽을 때 쓴다) */
export function renderForParse(rule: string, ctx: DocNumberContext, marker: string): string {
  return render(rule, ctx, () => marker);
}

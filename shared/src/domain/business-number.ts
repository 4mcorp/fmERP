const WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5] as const;

export function normalizeBusinessNumber(input: string): string {
  return input.replace(/[\s-]/g, "");
}

function checkDigit(first9: string): number {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(first9[i]) * (WEIGHTS[i] as number);
  sum += Math.floor((Number(first9[8]) * 5) / 10);
  return (10 - (sum % 10)) % 10;
}

/** 사업자등록번호 10자리와 체크섬을 검증한다 (PRD ORG-003) */
export function isValidBusinessNumber(input: string): boolean {
  const n = normalizeBusinessNumber(input);
  if (!/^\d{10}$/.test(n)) return false;
  return checkDigit(n.slice(0, 9)) === Number(n[9]);
}

/** 앞 9자리에 체크 숫자를 붙여 유효한 번호를 만든다 (시드·테스트용) */
export function makeBusinessNumber(first9: string): string {
  if (!/^\d{9}$/.test(first9)) throw new Error("앞 9자리 숫자가 필요합니다");
  return `${first9}${checkDigit(first9)}`;
}

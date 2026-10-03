/** 직위 마스터 기본값 (PRD ORG-030). 서열이 클수록 상위이며 계정마다 수정할 수 있다. */
const NAMES = [
  "사원",
  "주임",
  "대리",
  "과장",
  "차장",
  "부장",
  "이사",
  "상무",
  "전무",
  "부사장",
  "사장",
  "대표이사",
];

export const DEFAULT_POSITIONS: readonly { name: string; rank: number }[] = NAMES.map(
  (name, i) => ({ name, rank: (i + 1) * 10 }),
);

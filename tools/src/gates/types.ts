/**
 * 래칫 게이트: 위반을 문자열 키 목록으로 수집한다.
 * `pnpm arch:check`는 이 목록을 커밋된 기준선(`tools/baselines/<이름>.txt`)과 비교한다.
 * - 기준선에 없는 새 위반 → 실패
 * - 기준선에는 있는데 사라진 위반 → 실패 (기준선을 줄여 커밋해야 한다. 남은 여유분이 새 위반을 숨기지 못하게)
 * - 위반 수가 `limits.json`의 한도를 넘음 → 실패 (한도는 사람만 올릴 수 있다)
 */
export interface Gate {
  name: string;
  description: string;
  /** 정렬·중복 제거 전의 위반 키 목록 */
  collect(): Promise<string[]>;
}

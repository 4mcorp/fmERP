/** 원 단위 금액. DB에는 bigint로 저장하고 앱에서는 안전한 정수 범위의 number로 다룬다 (ADR 0002). */
export type Won = number & { readonly __brand: "Won" };

export function toWon(value: number): Won {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`금액은 안전한 정수(원)여야 합니다: ${value}`);
  }
  return value as Won;
}

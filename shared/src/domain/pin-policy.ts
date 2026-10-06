/** 결재 PIN 정책 (PRD AUTH-009) */
const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MINUTES = 15;
const PIN_REAUTH_MINUTES = 30;

export interface PinAttemptState {
  failedCount: number;
  lockedUntil: Date | null;
}

export function isPinFormatValid(pin: string): boolean {
  return /^\d{6,12}$/.test(pin);
}

export function pinLockState(
  state: PinAttemptState,
  now: Date,
): { locked: boolean; remainingSeconds: number } {
  if (!state.lockedUntil || state.lockedUntil.getTime() <= now.getTime()) {
    return { locked: false, remainingSeconds: 0 };
  }
  return {
    locked: true,
    remainingSeconds: Math.ceil((state.lockedUntil.getTime() - now.getTime()) / 1000),
  };
}

/** 실패를 기록한다. 5번째 실패에서 15분 잠그고 실패 횟수를 초기화한다. */
export function recordPinFailure(state: PinAttemptState, now: Date): PinAttemptState {
  const failedCount = state.failedCount + 1;
  if (failedCount >= PIN_MAX_FAILURES) {
    return { failedCount: 0, lockedUntil: new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000) };
  }
  return { failedCount, lockedUntil: state.lockedUntil };
}

/** PIN 검증 후 30분 동안은 다시 묻지 않는다. */
export function isPinReauthFresh(pinVerifiedAt: Date | null, now: Date): boolean {
  if (!pinVerifiedAt) return false;
  return now.getTime() - pinVerifiedAt.getTime() < PIN_REAUTH_MINUTES * 60_000;
}

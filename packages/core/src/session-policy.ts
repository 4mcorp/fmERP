/** 세션 만료 정책 (PRD AUTH-008). 계정별 정책이 있으면 우선한다. */
export interface SessionPolicy {
  idleTimeoutMinutes: number;
  absoluteTimeoutHours: number;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  idleTimeoutMinutes: 120,
  absoluteTimeoutHours: 12,
};

export function resolveSessionPolicy(accountPolicy?: Partial<SessionPolicy>): SessionPolicy {
  return { ...DEFAULT_SESSION_POLICY, ...accountPolicy };
}

export type SessionState = "active" | "idle_expired" | "absolute_expired";

export function evaluateSession(
  session: { createdAt: Date; lastActiveAt: Date; now: Date },
  policy: SessionPolicy,
): SessionState {
  const { createdAt, lastActiveAt, now } = session;
  if (now.getTime() - createdAt.getTime() >= policy.absoluteTimeoutHours * 3_600_000) {
    return "absolute_expired";
  }
  if (now.getTime() - lastActiveAt.getTime() >= policy.idleTimeoutMinutes * 60_000) {
    return "idle_expired";
  }
  return "active";
}

const TOUCH_INTERVAL_MS = 60_000;

/** 요청마다 DB에 쓰지 않도록, 마지막 갱신 후 1분이 지났을 때만 활동 시각을 갱신한다. */
export function shouldTouchSession(lastActiveAt: Date, now: Date): boolean {
  return now.getTime() - lastActiveAt.getTime() >= TOUCH_INTERVAL_MS;
}

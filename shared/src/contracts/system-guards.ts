/**
 * 시스템 관리자 전용 API가 쓰는 가드의 계약. 구현은 백업 기능(시스템 덤프)이 제공하고
 * 합성 루트(`apps/web/server/app.ts`)가 알림 같은 다른 기능의 라우트에 주입한다.
 */
import type { ServerDeps } from "../server/deps";
import type { AppEnv } from "../server/http";

export type SessionInfo = AppEnv["Variables"]["session"];

export interface SystemGuards {
  /** 시스템 관리자가 아니면 404 (존재를 알리지 않는다) */
  requireSystemAdmin(d: ServerDeps, session: SessionInfo): Promise<void>;
  /** PIN 재인증이 최근이 아니면 428 */
  requireStrictReauth(d: ServerDeps, session: SessionInfo): Promise<void>;
}

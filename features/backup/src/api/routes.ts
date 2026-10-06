import type { AppRouter, DepsProvider } from "@fmerp/shared/server/http";
import { registerExportRoutes } from "./export-routes";
import { registerSystemRoutes } from "./system-routes";

/** 시스템 덤프(/system/*)와 계정 내보내기(/account/exports) 라우트를 등록한다 */
export function registerBackupRoutes(app: AppRouter, deps: DepsProvider) {
  registerSystemRoutes(app, deps);
  registerExportRoutes(app, deps);
}

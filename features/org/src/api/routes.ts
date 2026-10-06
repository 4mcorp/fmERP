import type { AppRouter, DepsProvider } from "@fmerp/shared/server/http";
import { registerDepartmentRoutes } from "./departments-routes";
import { registerMemberRoutes } from "./members-routes";
import { registerOrgRoutes } from "./org-routes";

/** 구성원·조직·부서 라우트를 등록한다. 계정 기능의 /account/* 미들웨어 등록(registerAccountApi)보다 뒤에 호출해야 한다 */
export function registerOrgApi(app: AppRouter, deps: DepsProvider) {
  registerMemberRoutes(app, deps);
  registerOrgRoutes(app, deps);
  registerDepartmentRoutes(app, deps);
}

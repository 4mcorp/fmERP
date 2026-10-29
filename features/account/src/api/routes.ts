import type { AppRouter, DepsProvider } from "@fmerp/shared/server/http";
import { registerAccountRoutes } from "./account-routes";
import { type AccountProvisioning, registerAccountsRoutes } from "./accounts-routes";
import { registerAuthRoutes } from "./auth-routes";
import { registerMeRoutes } from "./me-routes";
import { registerPasskeyRoutes } from "./passkey-routes";

/**
 * 로그인·내 정보·회사 만들기/전환·초대 라우트를 등록한다. 순서가 중요하다: /account/* 인증·테넌트 미들웨어를
 * 마지막(account-routes)에 등록하므로, 조직 기능의 구성원 라우트는 이 함수보다 뒤에 등록해야 한다.
 */
export function registerAccountApi(
  app: AppRouter,
  deps: DepsProvider,
  provisioning: AccountProvisioning,
) {
  registerAuthRoutes(app, deps);
  registerMeRoutes(app, deps);
  registerPasskeyRoutes(app, deps);
  registerAccountsRoutes(app, deps, provisioning);
  registerAccountRoutes(app, deps);
}

import type { AppRouter, DepsProvider } from "@fmerp/shared/server/http";
import { registerApprovalAdminRoutes } from "./approval-admin-routes";
import { registerApprovalRoutes } from "./approvals-routes";
import { registerDocumentRoutes } from "./documents-routes";
import { registerFormRoutes } from "./forms-routes";
import { registerMailboxRoutes } from "./mailbox-routes";
import { registerRecipientRoutes } from "./recipients-routes";
import { registerSearchRoutes } from "./search-routes";

/**
 * 기안·양식·문서·수신·문서함 라우트. 완료 패키지 라우트(completion)가 이 뒤에 등록되고,
 * 검색·결재 관리(registerApprovalSupportApi)가 그 뒤에 등록된다. 등록 순서를 바꾸지 않는다.
 */
export function registerApprovalApi(app: AppRouter, deps: DepsProvider) {
  registerApprovalRoutes(app, deps);
  registerFormRoutes(app, deps);
  registerDocumentRoutes(app, deps);
  registerRecipientRoutes(app, deps);
  registerMailboxRoutes(app, deps);
}

export function registerApprovalSupportApi(app: AppRouter, deps: DepsProvider) {
  registerSearchRoutes(app, deps);
  registerApprovalAdminRoutes(app, deps);
}

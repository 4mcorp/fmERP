import { bodyLimit } from "hono/body-limit";
import { createApp } from "./create-app";
import { getServerDeps } from "./deps";
import { getEnv } from "./env";
import { requireSameOrigin } from "./http";
import { problem } from "./problem";
import { registerAccountRoutes } from "./routes/account";
import { registerAccountsRoutes } from "./routes/accounts";
import { registerApprovalAdminRoutes } from "./routes/approval-admin";
import { registerApprovalRoutes } from "./routes/approvals";
import { registerAuditRoutes } from "./routes/audit";
import { registerAuthRoutes } from "./routes/auth";
import { registerDepartmentRoutes } from "./routes/departments";
import { registerDocumentRoutes } from "./routes/documents";
import { registerExportRoutes } from "./routes/exports";
import { registerFormRoutes } from "./routes/forms";
import { registerMailboxRoutes } from "./routes/mailbox";
import { registerMeRoutes } from "./routes/me";
import { registerMemberRoutes } from "./routes/members";
import { registerOrgRoutes } from "./routes/org";
import { registerPackageRoutes } from "./routes/package";
import { registerRecipientRoutes } from "./routes/recipients";
import { registerSearchRoutes } from "./routes/search";
import { registerSystemRoutes } from "./routes/system";

/** API 요청 본문 최대 크기. 파일은 서명 URL로 저장소에 직접 올리므로 API 본문은 작다 (보안 리뷰 SR-3) */
const MAX_BODY_BYTES = 1024 * 1024;

export const app = createApp({
  pingDatabase: () => getServerDeps().pingDatabase(),
  register: (router) => {
    router.use(
      "*",
      bodyLimit({
        maxSize: MAX_BODY_BYTES,
        onError: () => problem(413, "payload_too_large", "요청 본문이 너무 큽니다"),
      }),
    );
    router.use(
      "*",
      requireSameOrigin(() => getEnv().BETTER_AUTH_URL),
    );
    registerAuthRoutes(router, getServerDeps);
    registerMeRoutes(router, getServerDeps);
    registerAccountsRoutes(router, getServerDeps);
    registerAccountRoutes(router, getServerDeps);
    // /account/* 인증·테넌트 미들웨어가 먼저 등록된 뒤에 추가한다
    registerMemberRoutes(router, getServerDeps);
    registerOrgRoutes(router, getServerDeps);
    registerDepartmentRoutes(router, getServerDeps);
    registerApprovalRoutes(router, getServerDeps);
    registerFormRoutes(router, getServerDeps);
    registerDocumentRoutes(router, getServerDeps);
    registerRecipientRoutes(router, getServerDeps);
    registerMailboxRoutes(router, getServerDeps);
    registerPackageRoutes(router, getServerDeps);
    registerSearchRoutes(router, getServerDeps);
    registerApprovalAdminRoutes(router, getServerDeps);
    registerAuditRoutes(router, getServerDeps);
    registerSystemRoutes(router, getServerDeps);
    registerExportRoutes(router, getServerDeps);
  },
});

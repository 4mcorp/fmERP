import { registerAccountApi } from "@fmerp/feature-account/api/routes";
import { requireView } from "@fmerp/feature-approval/api/guards";
import {
  registerApprovalApi,
  registerApprovalSupportApi,
} from "@fmerp/feature-approval/api/routes";
import { installDefaultForms } from "@fmerp/feature-approval/provisioning";
import { registerAuditRoutes } from "@fmerp/feature-audit/api/routes";
import { requireSystemAdmin } from "@fmerp/feature-backup/api/guards";
import { registerBackupRoutes } from "@fmerp/feature-backup/api/routes";
import { registerPackageRoutes } from "@fmerp/feature-completion/api/routes";
import { registerNotificationRoutes } from "@fmerp/feature-notification/api/routes";
import { registerOrgApi } from "@fmerp/feature-org/api/routes";
import { requireStrictReauth } from "@fmerp/shared/authz/reauth";
import { getEnv } from "@fmerp/shared/server/env";
import { requireSameOrigin } from "@fmerp/shared/server/http";
import { problem } from "@fmerp/shared/server/problem";
import { bodyLimit } from "hono/body-limit";
import { createApp } from "./create-app";
import { getServerDeps } from "./deps";

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
    registerAccountApi(router, getServerDeps, { installDefaultForms });
    // /account/* 인증·테넌트 미들웨어가 먼저 등록된 뒤에 추가한다
    registerOrgApi(router, getServerDeps);
    registerApprovalApi(router, getServerDeps);
    registerPackageRoutes(router, getServerDeps, { requireView });
    registerApprovalSupportApi(router, getServerDeps);
    registerAuditRoutes(router, getServerDeps, { requireView });
    registerBackupRoutes(router, getServerDeps);
    registerNotificationRoutes(router, getServerDeps, { requireSystemAdmin, requireStrictReauth });
  },
});

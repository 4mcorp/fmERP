import { type Db, schema } from "@fmerp/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";

export interface AuthConfig {
  /** fmerp_auth 역할로 연결한 DB (ADR 0005) */
  db: Db;
  baseURL: string;
  secret: string;
  /** 개발용 테스트 계정 로그인 (dev-login.ts의 조건을 통과했을 때만 true) */
  devTestLogin: boolean;
  /** 접속 IP로 믿을 헤더. 운영은 cf-connecting-ip만 (보안 리뷰 SR-1) */
  ipAddressHeaders: string[];
}

// Better Auth가 직접 여는 HTTP 경로 중, 감사 로그·업무 규칙을 우회할 수 있는 것은 막는다.
// 같은 기능은 감사 로그를 남기는 자체 API(/api/me, /api/account, /api/accounts, /api/invitations)로 제공한다.
// disabledPaths는 HTTP 라우터에만 적용되고 서버의 auth.api.* 호출에는 영향이 없다.
const ORGANIZATION_PATHS = [
  "accept-invitation",
  "add-team-member",
  "cancel-invitation",
  "check-slug",
  "create",
  "create-role",
  "create-team",
  "delete",
  "delete-role",
  "get-active-member",
  "get-active-member-role",
  "get-full-organization",
  "get-invitation",
  "get-organization",
  "get-role",
  "has-permission",
  "invite-member",
  "leave",
  "list",
  "list-invitations",
  "list-members",
  "list-roles",
  "list-team-members",
  "list-teams",
  "list-user-invitations",
  "list-user-teams",
  "reject-invitation",
  "remove-member",
  "remove-team",
  "remove-team-member",
  "set-active",
  "set-active-team",
  "update",
  "update-member-role",
  "update-role",
  "update-team",
].map((p) => `/organization/${p}`);

const USER_SELF_SERVICE_PATHS = [
  "/update-user",
  "/change-email",
  "/delete-user",
  "/change-password",
  "/set-password",
  "/request-password-reset",
  "/reset-password",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/list-accounts",
  "/link-social",
  "/unlink-account",
];

export const SESSION_ABSOLUTE_SECONDS = 12 * 60 * 60;

export function createAuth(config: AuthConfig) {
  return betterAuth({
    appName: "4mERP",
    baseURL: config.baseURL,
    secret: config.secret,
    basePath: "/api/auth",
    trustedOrigins: [config.baseURL],
    // 어댑터에는 테이블 이름이 아니라 모델 이름을 키로 넘긴다 (better-auth-best-practices)
    database: drizzleAdapter(config.db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        user_identity: schema.userIdentity,
        verification: schema.verification,
        account: schema.account,
        membership: schema.membership,
      },
    }),
    advanced: {
      // 기본 키는 DB의 uuidv7() (ADR 0001).
      // 스키마 검사는 끈다: 쓰지 않는 Better Auth 초대 모델의 테이블이 없어 실패하기 때문이다(ADR 0005).
      // 스키마 일치는 통합 테스트(apps/web/server/m1.int.test.ts)의 로그인·계정·구성원 흐름으로 검증한다.
      database: { generateId: false, validateSchema: false },
      cookiePrefix: "fmerp",
      // Cloudflare Tunnel 뒤에서 실제 접속 IP를 얻는다 (DEPLOYMENT_PLAN 3장)
      ipAddress: { ipAddressHeaders: config.ipAddressHeaders },
    },
    // 로그인 수단 테이블. 테넌트 account와 구분하기 위해 이름을 바꿨다 (ADR 0005)
    account: {
      modelName: "user_identity",
      fields: { accountId: "providerAccountId" },
      // 같은 이메일이어도 자동 병합하지 않는다 (PRD AUTH-004)
      accountLinking: { enabled: true, disableImplicitLinking: true },
    },
    session: {
      // 절대 만료 12시간. 유휴 만료(2시간)와 계정별 정책은 API 미들웨어에서 처리한다 (session.ts)
      expiresIn: SESSION_ABSOLUTE_SECONDS,
      disableSessionRefresh: true,
    },
    // 개발용 테스트 계정 로그인. 가입은 막아 시드 계정만 로그인할 수 있다
    emailAndPassword: {
      enabled: config.devTestLogin,
      disableSignUp: true,
      minPasswordLength: 8,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: { "/sign-in/email": { window: 60, max: 10 } },
    },
    disabledPaths: [...ORGANIZATION_PATHS, ...USER_SELF_SERVICE_PATHS],
    plugins: [
      organization({
        creatorRole: "owner",
        disableOrganizationDeletion: true,
        schema: {
          session: { fields: { activeOrganizationId: "activeAccountId" } },
          organization: { modelName: "account" },
          member: { modelName: "membership", fields: { organizationId: "accountId" } },
          // Better Auth 초대는 쓰지 않는다 (자체 invitation 테이블, ADR 0005)
          invitation: { modelName: "unused_ba_invitation" },
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * 합성 루트가 ServerDeps.auth에 넣은 처리기를 Better Auth 타입으로 좁힌다.
 * 공통 영역(ServerDeps)은 계정 기능을 import할 수 없어 최소 모양(AuthHandle)만 알기 때문이다.
 */
export function authOf(deps: { auth: unknown }): Auth {
  return deps.auth as Auth;
}

// 인증·계정 (M1). Better Auth 설정과 fmerp_auth 연결로 동작하는 서비스. 규칙: docs/rules/security.md

export {
  type AuthServiceDeps,
  acceptInvitation,
  createAccount,
  createInvitationToken,
  hashInvitationToken,
  type InvitationPreset,
  listMyAccounts,
  previewInvitation,
  switchActiveAccount,
} from "./accounts";
export { type Auth, type AuthConfig, authOf, createAuth } from "./auth";
export { resolveDevTestLogin } from "./dev-login";
export {
  getProfile,
  listLoginHistory,
  listMySessions,
  type ProfilePatch,
  revokeMySession,
  updateProfile,
} from "./me";
export { setApprovalPin, verifyApprovalPin } from "./pin";
export { DEV_TEST_PASSWORD, TEST_ACCOUNTS, TEST_USERS, type TestUser } from "./test-accounts";

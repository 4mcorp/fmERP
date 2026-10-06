/**
 * 기능 배정표 (기능 구조 전환 계획 P0, docs/plan/2026-10-06-feature-architecture-refactor.md 3.3).
 * 파일이 아직 `features/<이름>/`으로 옮겨지기 전의 **현재 위치**를 목표 기능에 대응시킨다.
 * 기능 폴더로 옮겨진 파일은 경로 자체가 기능을 알려 주므로 맨 위 규칙이 처리한다.
 *
 * - 위에서부터 **처음 맞는 규칙**이 이긴다.
 * - 어느 규칙에도 안 맞는 소스 파일이 있으면 arch-check가 실패한다. 새 파일은 반드시 배정되어야 한다.
 * - 이 표는 기능 이동이 끝나면(P10) 지워지고 `features/*` 경로 규칙만 남는다.
 */

const FEATURES = [
  "account",
  "approval",
  "audit",
  "backup",
  "completion",
  "home",
  "notification",
  "org",
] as const;
type Feature = (typeof FEATURES)[number];

/** `shared`: 모든 기능이 쓸 수 있는 공통 영역. `composition`: 기능을 조립하는 합성 루트(여러 기능 import 허용) */
export type Owner = Feature | "shared" | "composition";

type Rule = readonly [pattern: RegExp, owner: Owner];

const RULES: readonly Rule[] = [
  // ── 공통 영역 (이전 후) ──
  [/^shared\//, "shared"],

  // 결재 이벤트 계약: 결재가 만들고 알림이 읽는다 (해체 시 shared/contracts로)
  [/^packages\/core\/src\/approval-event\.ts$/, "shared"],

  // ── 합성 루트: 기능을 모아 연결한다 ──
  [/^apps\/web\/app\/api\//, "composition"],
  [/^apps\/web\/server\/(app|create-app)\.ts$/, "composition"],
  [/^apps\/worker\/src\/main\.ts$/, "composition"],
  [/^apps\/web\/app\/\(app\)\/layout\.tsx$/, "composition"],
  [/^apps\/web\/app\/\(app\)\/admin\/layout\.tsx$/, "composition"],
  [/^apps\/web\/app\/\(app\)\/me\/page\.tsx$/, "composition"], // 내 정보: 계정 화면에 알림 조각을 끼운다
  [/^apps\/web\/components\/app-shell\.tsx$/, "composition"],

  // ── 알림 ──
  [/^packages\/notification\//, "notification"],
  [/^packages\/core\/src\/notification-rules/, "notification"],
  [/^apps\/worker\/src\/notification-/, "notification"],
  [/^apps\/web\/server\/(notifications\/|routes\/notifications\.ts)/, "notification"],
  [/^apps\/web\/components\/me\/telegram-section\.tsx$/, "notification"],
  [/^apps\/web\/app\/\(app\)\/(notifications|system\/telegram)\//, "notification"],
  [/^apps\/web\/e2e\/m8\.spec\.ts$/, "notification"],

  // ── 백업·내보내기 ──
  [/^packages\/backup\//, "backup"],
  [/^packages\/core\/src\/(backup|doc-number-parse)/, "backup"],
  [/^apps\/worker\/src\/(backup-|cli\/)/, "backup"],
  [/^apps\/web\/server\/(system\/|account-export|routes\/(system|exports)\.ts)/, "backup"],
  [/^apps\/web\/components\/backup\//, "backup"],
  [/^apps\/web\/app\/\(app\)\/(system\/backups|admin\/backups)\//, "backup"],
  [/^apps\/web\/e2e\/m7\.spec\.ts$/, "backup"],

  // ── 완료 패키지 ──
  [/^packages\/completion\//, "completion"],
  [/^packages\/core\/src\/completion-package/, "completion"],
  [/^apps\/worker\/src\/(package-jobs|render|fonts|health)/, "completion"],
  [
    /^apps\/web\/server\/(routes\/package\.ts|approval\/(package-download|document-storage))/,
    "completion",
  ],
  [/^apps\/web\/components\/approval\/completion-files\.tsx$/, "completion"],

  // ── 감사 ──
  [/^packages\/core\/src\/audit-/, "audit"],
  [/^apps\/web\/server\/(audit\/|routes\/audit\.ts)/, "audit"],
  [/^apps\/web\/components\/approval\/audit-trail\.tsx$/, "audit"],
  [/^apps\/web\/app\/\(app\)\/admin\/audit\//, "audit"],
  [/^apps\/web\/e2e\/m6\.spec\.ts$/, "audit"],

  // ── 결재 (엔진 + 양식 + 문서함·검색·수신, 하나의 스코프 — 결정 Q2) ──
  [
    /^packages\/core\/src\/(approval-|delegation|doc-number|step-transfer|document-access|form-)/,
    "approval",
  ],
  [/^apps\/web\/server\/approval\//, "approval"],
  [
    /^apps\/web\/server\/routes\/(approvals|approval-admin|documents|forms|mailbox|search|recipients)\.ts$/,
    "approval",
  ],
  [/^apps\/web\/components\/approval\//, "approval"],
  [/^apps\/web\/lib\/local-drafts\.ts$/, "approval"],
  [/^apps\/web\/app\/\(app\)\/(approval|mailbox|search)\//, "approval"],
  [/^apps\/web\/app\/\(app\)\/admin\/(approvals|forms)\//, "approval"],
  [/^apps\/web\/e2e\/m(4|5)\.spec\.ts$/, "approval"],

  // ── 공통 영역 ──
  [/^packages\/(db|audit|storage)\//, "shared"],
  [/^packages\/core\/src\/(index|money|file-sniff|permissions)/, "shared"],
  [/^apps\/web\/server\/(db|test-client)\.ts$/, "shared"],
  [/^apps\/web\/server\/deps\.ts$/, "composition"], // 실제 연결(DB·인증·저장소)을 만드는 합성 루트
  [/^apps\/web\/lib\/(api|utils|queries|types)\.ts$/, "shared"],
  [/^apps\/web\/components\/ui\//, "shared"],
  [/^apps\/web\/app\/(layout|providers)\.tsx$/, "shared"],
  [/^apps\/worker\/src\/env\.ts$/, "shared"],
  [
    /^(apps\/(web|worker)\/(next|playwright|vitest)\.config\.ts|apps\/web\/e2e\/(global-setup|test-env)\.ts)$/,
    "shared",
  ],
  [/^apps\/web\/e2e\/(smoke)\.spec\.ts$/, "shared"],
  [/^tools\//, "shared"],
  [/\.(css|d\.ts)$|^apps\/web\/postcss\.config\.mjs$/, "shared"],

  // ── 계정(로그인·세션·PIN·초대·내 정보) ──
  [/^packages\/auth\//, "account"],
  [/^packages\/core\/src\/(session-policy|pin-policy)/, "account"],
  [/^apps\/web\/server\/routes\/(auth|me|accounts|account|reauth)\.ts$/, "account"],
  [/^apps\/web\/components\/me\//, "account"],
  [/^apps\/web\/app\/(login|dev-login)\//, "account"],
  [/^apps\/web\/app\/\(app\)\/(me|invite|onboarding)\//, "account"],
  [/^apps\/web\/e2e\/m1\.spec\.ts$/, "account"],

  // ── 조직·권한 ──
  [/^packages\/core\/src\/(assignment|department-|org-defaults|business-number)/, "org"],
  [/^apps\/web\/server\/(routes\/(org|departments|members)\.ts|in-flight\.ts)/, "org"],
  [/^apps\/web\/components\/org\//, "org"],
  [/^apps\/web\/lib\/(admin-nav|org-tree)\.ts$/, "org"],
  [/^apps\/web\/app\/\(app\)\/org\//, "org"],
  [/^apps\/web\/app\/\(app\)\/admin\/(settings|businesses|org|members|positions)\//, "org"],
  [/^apps\/web\/e2e\/m2\.spec\.ts$/, "org"],

  // ── 홈 ──
  [/^apps\/web\/app\/\(app\)\/page\.tsx$/, "home"],
];

/** 파일의 소유자. 배정되지 않은 파일이면 `null` */
export function ownerOf(path: string): Owner | null {
  const inFeature = /^features\/([^/]+)\//.exec(path);
  if (inFeature?.[1]) return inFeature[1] as Feature;
  for (const [pattern, owner] of RULES) if (pattern.test(path)) return owner;
  return null;
}

/** 시험·도구 파일 (결합 측정에서 제외) */
export const isTestFile = (path: string) =>
  /(\.test\.|\.int\.test\.|\.spec\.|\/test-support\.|\/test-client\.|\/test\/|\/e2e\/)/.test(path);

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

  // ── 합성 루트: 기능을 모아 연결한다 ──
  [/^apps\/web\/app\/api\//, "composition"],
  [/^apps\/web\/server\/(app|create-app|seed-cli|test-global-setup)\.ts$/, "composition"],
  [/^apps\/web\/server\/seed\//, "composition"], // 시험·개발 시드: 계정·조직·양식 표를 함께 채운다
  [/^apps\/worker\/src\/main\.ts$/, "composition"],
  [/^apps\/web\/app\/\(app\)\/layout\.tsx$/, "composition"],
  [/^apps\/web\/app\/manifest\.ts$/, "composition"], // 홈 화면 설치 정보 (PWA): 앱 셸 메타라 합성 루트 소유
  [/^apps\/web\/app\/\(app\)\/admin\/layout\.tsx$/, "composition"],
  // Next 페이지 어댑터: 기능의 화면 진입점을 한 줄로 내보낸다 (내 정보는 계정 화면에 알림 조각을 끼운다)
  [
    /^apps\/web\/app\/\(app\)\/(me|notifications|system\/telegram|system\/backups|admin\/backups|admin\/audit|admin\/audit\/review|approval\/\[id\]|invite\/\[token\]|onboarding|org|admin\/(settings|businesses|org|members|positions))\/page\.tsx$/,
    "composition",
  ],
  [/^apps\/web\/app\/(login|dev-login)\/page\.tsx$/, "composition"],
  [
    /^apps\/web\/app\/\(app\)\/(approval\/(draft\/\[id\]|mine|new|pending)|mailbox|mailbox\/\[box\]|me\/absence|search|admin\/(approvals|forms|forms\/\[id\]))\/page\.tsx$/,
    "composition",
  ],
  [/^apps\/web\/components\/app-shell\.tsx$/, "composition"],

  // ── 알림 ── (코드는 features/notification/으로 이동 완료: 경로가 소유자를 알려 준다. E2E만 남아 있다)
  [/^apps\/web\/e2e\/m8\.spec\.ts$/, "notification"],
  [/^apps\/web\/e2e\/pwa\.spec\.ts$/, "notification"],
  [/^apps\/web\/app\/sw\.js\/route\.ts$/, "composition"], // 서비스 워커 제공 라우트 (Next 엔트리). 소스는 features/notification/src/sw/

  // ── 백업·내보내기 ── (코드는 features/backup/으로 이동 완료. E2E만 남아 있다)
  [/^apps\/web\/e2e\/m7\.spec\.ts$/, "backup"],

  // ── 완료 패키지 ── (코드는 features/completion/으로 이동 완료)

  // ── 감사 ── (코드는 features/audit/으로 이동 완료. E2E만 남아 있다)
  [/^apps\/web\/e2e\/m6\.spec\.ts$/, "audit"],

  // worker 운영자 CLI·상태 확인 서버: 기능의 진입점을 엮는 합성 루트
  [/^apps\/worker\/src\/(cli\/|health\.ts$)/, "composition"],

  // ── 결재 (엔진 + 양식 + 문서함·검색·수신, 하나의 스코프 — 결정 Q2) ──
  // (코드는 features/approval/로 이동 완료. E2E만 남아 있다)
  [/^apps\/web\/e2e\/m(4|5)\.spec\.ts$/, "approval"],

  // ── 공통 영역 ──
  [/^packages\/(db|audit|storage)\//, "shared"],
  [/^apps\/web\/server\/(db)\.ts$/, "shared"],
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
  [/^apps\/web\/server\/e2e-server-mode\.test\.ts$/, "shared"], // E2E 러너 공개 설정 계약
  [/^tools\//, "shared"],
  [/\.(css|d\.ts)$|^apps\/web\/postcss\.config\.mjs$/, "shared"],

  // ── 계정(로그인·세션·PIN·초대·내 정보) ── (코드는 features/account/로 이동 완료. E2E만 남아 있다)
  [/^apps\/web\/e2e\/m1\.spec\.ts$/, "account"],

  // ── 조직·권한 ── (코드는 features/org/로 이동 완료. E2E만 남아 있다)
  [/^apps\/web\/e2e\/m2\.spec\.ts$/, "org"],

  // ── 홈 ── (코드는 features/home/으로 이동 완료. app/(app)/page.tsx는 한 줄 어댑터)
  [/^apps\/web\/app\/\(app\)\/page\.tsx$/, "composition"],
  [/^apps\/web\/e2e\/loading-error\.spec\.ts$/, "home"], // 홈·앱 셸의 로딩·오류·404 시험

  // ── 앱 셸 경계 (에러·로딩·404 화면) ──
  [/^apps\/web\/app\/\(app\)\/(error|loading)\.tsx$/, "composition"],
  [/^apps\/web\/app\/not-found\.tsx$/, "composition"],
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

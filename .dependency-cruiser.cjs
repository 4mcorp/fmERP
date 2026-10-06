/**
 * 의존 규칙 (기능 구조 전환 계획 4.1, docs/plan/2026-10-06-feature-architecture-refactor.md).
 * 해석된 실제 경로 기준이다. 위반은 `pnpm arch:check`가 기준선(tools/baselines)과 비교해 새 위반을 실패시키고,
 * 위반이 줄었는데 기준선을 안 줄여도 실패시킨다(래칫). 이 파일은 CODEOWNERS 보호 대상이다.
 *
 * 아래 `features/`·`shared/` 규칙은 기능 이동(P3~)이 끝나기 전에는 일치하는 파일이 없어 아무것도 잡지 않는다.
 * tools/src/__tests__/depcruise-rules.test.ts가 임시 폴더로 이 규칙이 실제로 잡는지 확인한다.
 */
const TEST_FILE =
  "\\.(test|spec)\\.(ts|tsx)$|\\.int\\.test\\.ts$|/test-support\\.ts$|/test-client\\.ts$|(^|/)e2e/|(^|/)__tests__/";
/** 시험 실행 설정은 시험 도우미(env 등)를 읽는다 */
const TEST_CONFIG = "(^|/)(playwright|vitest)\\.config\\.ts$";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "값 import 순환 금지. 타입 전용 import로만 이어진 순환은 실행에 영향이 없어 제외한다(viaOnly).",
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
    },
    {
      name: "no-test-in-production",
      severity: "error",
      comment: "프로덕션 코드가 테스트·도우미 파일을 import하지 않는다.",
      from: { pathNot: [TEST_FILE, "^tools/", TEST_CONFIG] },
      to: { path: TEST_FILE },
    },
    {
      name: "apps-do-not-import-each-other",
      severity: "error",
      comment: "apps 사이 import 금지 (docs/rules/architecture.md 1장).",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "packages-do-not-import-apps",
      severity: "error",
      comment: "packages는 apps를 import하지 않는다 (역방향 의존 금지).",
      from: { path: "^(packages|features|shared)/" },
      to: { path: "^apps/" },
    },
    {
      name: "domain-is-pure",
      severity: "error",
      comment:
        "도메인 규칙(packages/core, 이전 후 features/*/src/domain·shared/domain)은 DB·저장소·프레임워크·네트워크를 import하지 않는다 (CLAUDE.md 불변 조건).",
      from: { path: "^(packages/core/src|features/[^/]+/src/domain|shared/(src/)?domain)/" },
      to: {
        path: [
          "^packages/(db|storage|auth|audit|completion|backup|notification)/",
          "^shared/(src/)?(server|authz|db|storage|http|env|ui)/",
          "node_modules/(drizzle-orm|pg|pg-boss|hono|@hono|next|react|react-dom|@aws-sdk)/",
        ],
      },
    },
    {
      name: "no-cross-feature",
      severity: "error",
      comment:
        "한 기능은 다른 기능을 import하지 않는다. 필요하면 shared로 올리거나 계약+주입, 이벤트를 쓴다.",
      from: { path: "^features/([^/]+)/" },
      to: { path: "^features/", pathNot: "^features/$1/" },
    },
    {
      name: "feature-imports-only-shared",
      severity: "error",
      comment:
        "기능은 자기 폴더와 shared(및 외부 라이브러리)만 import한다. 합성 루트(apps)나 도구를 import하지 않는다.",
      from: { path: "^features/" },
      to: { path: "^(apps|tools)/" },
    },
    {
      name: "shared-must-not-import-features",
      severity: "error",
      comment:
        "공통 영역은 기능을 import하지 않는다 (공통이 기능에 의존하면 모든 사용처가 그 기능에 의존하게 된다).",
      from: { path: "^(shared|packages/(db|audit|storage))/" },
      to: { path: "^(features|apps)/" },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment: "해석되지 않는 import는 오타이거나 선언되지 않은 의존성이다.",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(\\.next|node_modules|dist|coverage|artifacts)/|migrations/meta" },
    tsConfig: { fileName: "tsconfig.depcruise.json" },
    // 컴파일 전의 import를 본다 → `import type`을 구분해 타입 전용 순환을 제외할 수 있다
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types"],
    },
    reporterOptions: { text: { highlightFocused: false } },
  },
};

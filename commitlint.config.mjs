// 커밋 메시지 규칙: docs/rules/git.md
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
      ],
    ],
    "scope-enum": [
      2,
      "always",
      [
        "approval",
        "org",
        "auth",
        "audit",
        "storage",
        "backup",
        "notify",
        "admin",
        "db",
        "ui",
        "worker",
        "infra",
        "deps",
        "docs",
        "claude",
      ],
    ],
    // 설명은 한국어로 쓰므로 대소문자 규칙은 끈다
    "subject-case": [0],
    "header-max-length": [2, "always", 100],
    "body-max-line-length": [0],
  },
};

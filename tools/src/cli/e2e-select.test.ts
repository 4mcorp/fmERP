import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

const cli = resolve("tools/src/cli/e2e-select.ts");
const repos: string[] = [];
function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
function put(cwd: string, path: string, text = path) {
  mkdirSync(dirname(resolve(cwd, path)), { recursive: true });
  writeFileSync(resolve(cwd, path), text);
}
function repository() {
  const cwd = mkdtempSync(resolve(tmpdir(), "e2e-selector-"));
  repos.push(cwd);
  git(cwd, "init", "-q");
  git(cwd, "config", "user.name", "Selector Test");
  git(cwd, "config", "user.email", "selector@example.invalid");
  put(cwd, "features/org/src/ui/example.tsx");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "fixture base");
  return { cwd, base: git(cwd, "rev-parse", "HEAD") };
}
function invoke(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}
afterEach(() => {
  for (const cwd of repos.splice(0)) rmSync(cwd, { recursive: true, force: true });
});

test.each([
  "shared/src/a.ts",
  "features/new-feature/src/a.ts",
  "features/home/src/a.ts",
  ".github/workflows/ci.yml",
  "README.md",
])("CLI: 공유·불명·홈 변경 %s는 전체 실행으로 보수적으로 승격한다", (path) => {
  const { cwd, base } = repository();
  put(cwd, path);
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "shared change");
  const result = invoke(cwd, "--base", base, "--head", "HEAD");
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    mode: "full",
    commands: [{ args: ["--filter", "@fmerp/web", "exec", "playwright", "test"] }],
  });
});

test.each(
  [[], ["--full"], ["--base", "missing-ref"], ["--base", "HEAD", "--head", "HEAD"]].map((args) => ({
    args,
  })),
)("CLI: 비교 불가·명시 full·빈 diff $args는 빈 선택 성공 대신 전체 실행한다", ({ args }) => {
  const { cwd } = repository();
  const result = invoke(cwd, ...args);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    mode: "full",
    commands: [{ args: ["--filter", "@fmerp/web", "exec", "playwright", "test"] }],
  });
});

test("CLI: rename은 옛·새 경로 모두 반영하여 공유 파일을 기능 폴더로 옮겨도 full을 유지한다", () => {
  const { cwd, base } = repository();
  put(cwd, "shared/src/old.ts", "same content");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "shared base");
  const beforeRename = git(cwd, "rev-parse", "HEAD");
  git(cwd, "mv", "shared/src/old.ts", "features/org/src/renamed.ts");
  git(cwd, "commit", "-qm", "rename shared");
  const result = invoke(cwd, "--base", beforeRename, "--head", "HEAD");
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    mode: "full",
    changedPaths: ["features/org/src/renamed.ts", "shared/src/old.ts"],
  });
  expect(base).not.toBe(beforeRename);
});

test("CLI: 삭제 경로도 선택에 남고, 매 실행은 지정한 head의 merge-base diff만 다시 계산한다", () => {
  const { cwd, base } = repository();
  git(cwd, "branch", "feature-head");
  put(cwd, "shared/src/base-only.ts");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "base advanced");
  const advancedBase = git(cwd, "rev-parse", "HEAD");
  git(cwd, "switch", "-q", "feature-head");
  git(cwd, "rm", "features/org/src/ui/example.tsx");
  put(cwd, "features/notification/src/ui/한 글\nfile.ts");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "delete and add");
  const first = invoke(cwd, "--base", advancedBase, "--head", "HEAD");
  expect(first.status, first.stderr).toBe(0);
  expect(JSON.parse(first.stdout)).toMatchObject({
    mode: "selective",
    features: ["notification", "org"],
    changedPaths: [
      "features/notification/src/ui/한 글\nfile.ts",
      "features/org/src/ui/example.tsx",
    ],
    commands: [
      {
        args: [
          "--filter",
          "@fmerp/web",
          "exec",
          "playwright",
          "test",
          "e2e/m2.spec.ts",
          "e2e/m8.spec.ts",
          "e2e/passkey.spec.ts",
          "e2e/pwa.spec.ts",
          "e2e/smoke.spec.ts",
          "--grep",
          "(?:smoke|passkey)\\.spec\\.ts(?!.*@stateful)|m2\\.spec\\.ts|m8\\.spec\\.ts|pwa\\.spec\\.ts",
        ],
      },
    ],
  });
  expect(invoke(cwd, "--base", advancedBase, "--head", "HEAD").stdout).toBe(first.stdout);
  expect(JSON.parse(invoke(cwd, "--base", base, "--head", base).stdout)).toMatchObject({
    mode: "full",
    reason: "empty-diff",
    changedPaths: [],
  });
});

test.each([
  "features/approval/src/service/documents.ts",
  "features/approval/src/api/routes.ts",
  "features/approval/src/domain/approval.ts",
  "features/approval/src/jobs/complete.ts",
  "features/org/src/entrypoint.ts",
  "features/org/feature.map.yaml",
])("CLI: 검증되지 않은 런타임 교차 영향 %s는 전체 E2E로 폴백한다", (path) => {
  const { cwd, base } = repository();
  put(cwd, path, "changed");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "runtime contract change");
  const result = invoke(cwd, "--base", base);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    mode: "full",
    reason: "unproven-runtime-impact",
    commands: [{ args: ["--filter", "@fmerp/web", "exec", "playwright", "test"] }],
  });
});

test.each(["--invalid", "--base", "--head", "--base --full", "--full --full"])(
  "CLI: 잘못된 옵션 %s는 사용 오류(exit 2)이며 실행하지 않는다",
  (input) => {
    const { cwd } = repository();
    const result = invoke(cwd, ...input.split(" "));
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
  },
);

test.each([0, 7])(
  "CLI --run: 선택 명령을 셸 없이 실행하고 자식 실패 %s를 그대로 전파한다",
  (exitCode) => {
    const { cwd, base } = repository();
    put(cwd, "features/org/src/ui/example.tsx", "changed");
    git(cwd, "commit", "-qam", "org change");
    put(
      cwd,
      "bin/pnpm",
      `#!${process.execPath}\nconsole.log('CHILD ' + JSON.stringify(process.argv.slice(2))); process.exit(${exitCode});\n`,
    );
    chmodSync(resolve(cwd, "bin/pnpm"), 0o755);
    const result = spawnSync(process.execPath, [cli, "--base", base, "--head", "HEAD", "--run"], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, PATH: `${resolve(cwd, "bin")}:${process.env.PATH}` },
    });
    expect(result.status, result.stderr).toBe(exitCode);
    const lines = result.stdout.trim().split("\n");
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ mode: "selective" });
    expect(lines.slice(1)).toHaveLength(1);
    expect(lines[1]).toBe(
      'CHILD ["--filter","@fmerp/web","exec","playwright","test","e2e/m2.spec.ts","e2e/passkey.spec.ts","e2e/smoke.spec.ts","--grep","(?:smoke|passkey)\\\\.spec\\\\.ts(?!.*@stateful)|m2\\\\.spec\\\\.ts"]',
    );
  },
);

test.each(["org", "account"])(
  "CLI: %s 선택을 실제 Playwright --list로 확인한다 (서버·DB·브라우저 실행 없음)",
  (feature) => {
    const { cwd, base } = repository();
    put(cwd, `features/${feature}/src/ui/changed.ts`);
    git(cwd, "add", ".");
    git(cwd, "commit", "-qm", "feature change");
    const plan = JSON.parse(invoke(cwd, "--base", base).stdout);
    const result = spawnSync(
      process.execPath,
      [
        resolve("apps/web/node_modules/@playwright/test/cli.js"),
        ...plan.commands[0].args.slice(4),
        "--list",
        "--reporter=line",
      ],
      { cwd: resolve("apps/web"), encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("smoke.spec.ts");
    expect(result.stdout).toContain(
      "로그인 버튼은 키보드(Tab·Enter)로 도달·실행되고 포커스 표시가 보인다",
    );
    if (feature === "org") {
      expect(result.stdout).toContain("사업자 등록 검증, 부서 생성·뎁스 제한·이동");
      expect(result.stdout).not.toContain("등록→로그아웃→로그인");
      expect(result.stdout).not.toContain("m1.spec.ts");
    } else {
      expect(result.stdout).toContain("등록→로그아웃→로그인");
      expect(result.stdout).toContain("m1.spec.ts");
      expect(result.stdout).not.toContain("m2.spec.ts");
    }
  },
);

test("CLI: 감사 변경은 감사 화면뿐 아니라 인쇄 기록을 검사하는 기존 미리보기 E2E도 선택한다", () => {
  const { cwd, base } = repository();
  put(cwd, "features/audit/src/ui/changed.ts");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "audit change");
  const result = invoke(cwd, "--base", base);
  expect(result.status, result.stderr).toBe(0);
  const args = JSON.parse(result.stdout).commands[0].args;
  expect(args).toContain("e2e/m6.spec.ts");
  expect(args).toContain("e2e/print-preview.spec.ts");
});

test("CLI: 기능+문서 혼합 변경은 영향 기능을 기록하되 full로 승격한다", () => {
  const { cwd, base } = repository();
  put(cwd, "features/org/src/ui/example.tsx", "changed");
  put(cwd, "docs/readme.md");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "org plus docs");
  const result = invoke(cwd, "--base", base);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    mode: "full",
    features: ["org"],
    changedPaths: ["docs/readme.md", "features/org/src/ui/example.tsx"],
  });
});

test("CLI: org 변경은 항상 core smoke·읽기 전용 passkey와 영향 m2를 JSON으로 선택한다", () => {
  const { cwd, base } = repository();
  put(cwd, "features/org/src/ui/example.tsx", "changed");
  git(cwd, "commit", "-qam", "org change");
  const result = invoke(cwd, "--base", base, "--head", "HEAD");
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    schemaVersion: 1,
    mode: "selective",
    features: ["org"],
    changedPaths: ["features/org/src/ui/example.tsx"],
    commands: [
      {
        args: [
          "--filter",
          "@fmerp/web",
          "exec",
          "playwright",
          "test",
          "e2e/m2.spec.ts",
          "e2e/passkey.spec.ts",
          "e2e/smoke.spec.ts",
          "--grep",
          "(?:smoke|passkey)\\.spec\\.ts(?!.*@stateful)|m2\\.spec\\.ts",
        ],
      },
    ],
  });
});

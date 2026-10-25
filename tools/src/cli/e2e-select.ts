import { execFileSync, spawnSync } from "node:child_process";

// docs/feature-map/INDEX.md 및 각 feature.map.yaml의 기존 E2E 경로.
// home은 지도에 smoke·m1~m8 전체가 명시되어 있으므로 전체 실행한다.
const affected: Record<string, string[]> = {
  account: ["e2e/m1.spec.ts", "e2e/passkey.spec.ts"],
  approval: ["e2e/m4.spec.ts", "e2e/m5.spec.ts", "e2e/print-preview.spec.ts"],
  audit: ["e2e/m6.spec.ts", "e2e/print-preview.spec.ts"],
  backup: ["e2e/m7.spec.ts"],
  completion: ["e2e/m5.spec.ts", "e2e/print-preview.spec.ts"],
  notification: ["e2e/m8.spec.ts", "e2e/pwa.spec.ts"],
  org: ["e2e/m2.spec.ts"],
};
const prefix = ["--filter", "@fmerp/web", "exec", "playwright", "test"];
const argv = process.argv.slice(2);
let base: string | undefined;
let head = "HEAD";
let forceFull = false;
let run = false;
const seen = new Set<string>();
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (!arg || seen.has(arg)) {
    console.error("중복된 E2E selector 옵션");
    process.exit(2);
  }
  seen.add(arg);
  if (arg === "--full") forceFull = true;
  else if (arg === "--run") run = true;
  else if (arg === "--base" || arg === "--head") {
    const value = argv[++index];
    if (!value || value.startsWith("-") || [...value].some((char) => char.charCodeAt(0) < 32)) {
      console.error("--base/--head에는 git commit ref가 필요합니다");
      process.exit(2);
    }
    if (arg === "--base") base = value;
    else head = value;
  } else {
    console.error("알 수 없는 E2E selector 옵션");
    process.exit(2);
  }
}
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
let reason = forceFull ? "explicit-full" : "missing-base";
let changedPaths: string[] = [];
if (!forceFull && base) {
  try {
    const baseCommit = git("rev-parse", "--verify", "--end-of-options", `${base}^{commit}`).trim();
    const headCommit = git("rev-parse", "--verify", "--end-of-options", `${head}^{commit}`).trim();
    const mergeBase = git("merge-base", baseCommit, headCommit).trim();
    const entries = git(
      "diff",
      "--name-status",
      "-z",
      "--find-renames",
      mergeBase,
      headCommit,
      "--",
    ).split("\0");
    const paths: string[] = [];
    for (let index = 0; index < entries.length - 1; ) {
      const status = entries[index++];
      if (!status || !/^(?:[ADMTUXB]|[RC]\d+)$/.test(status))
        throw new Error("unknown diff status");
      const count = /^[RC]/.test(status) ? 2 : 1;
      for (let offset = 0; offset < count; offset += 1) {
        const path = entries[index++];
        if (!path) throw new Error("missing diff path");
        paths.push(path);
      }
    }
    changedPaths = [...new Set(paths)].sort();
    reason = changedPaths.length === 0 ? "empty-diff" : "affected-features";
  } catch {
    reason = "diff-unavailable";
  }
}
const features = [
  ...new Set(changedPaths.flatMap((path) => /^features\/([^/]+)\//.exec(path)?.[1] ?? [])),
].sort();
if (
  changedPaths.some((path) => {
    const feature = /^features\/([^/]+)\//.exec(path)?.[1];
    return !feature || !Object.hasOwn(affected, feature);
  })
)
  reason = "unknown-or-shared-path";
else if (changedPaths.some((path) => !/^features\/[^/]+\/src\/ui\//.test(path))) {
  // 기능 간 import 금지만으로 합성 루트 DI/API의 런타임 교차 영향을 배제할 수 없다.
  // 검증된 직접 화면 범위만 선택하며 service/domain/API/jobs·지도·시험 변경은 전체 실행한다.
  reason = "unproven-runtime-impact";
}
const files = [...new Set(features.flatMap((feature) => affected[feature] ?? []))].sort();
const full = reason !== "affected-features" || files.length === 0;
const selection = {
  schemaVersion: 1,
  mode: full ? "full" : "selective",
  reason,
  features,
  changedPaths,
  // 한 Playwright 실행으로 묶어 DB reset·Next build와 JSON 리포트 덮어쓰기를 피한다.
  // grep은 파일명+제목+태그에 적용한다. 영향 파일의 @stateful은 제외하지 않는다.
  commands: [
    {
      args: full
        ? prefix
        : [
            ...prefix,
            ...[...new Set(["e2e/smoke.spec.ts", "e2e/passkey.spec.ts", ...files])].sort(),
            "--grep",
            [
              "(?:smoke|passkey)\\.spec\\.ts(?!.*@stateful)",
              ...files.map((file) => file.slice(4).replaceAll(".", "\\.")),
            ].join("|"),
          ],
    },
  ],
};
console.log(JSON.stringify(selection));
if (run) {
  for (const command of selection.commands) {
    const result = spawnSync("pnpm", command.args, { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

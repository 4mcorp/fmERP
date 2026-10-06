// .dependency-cruiser.cjs의 규칙이 실제로 위반을 잡는지, 잡지 말아야 할 것은 안 잡는지 임시 저장소로 확인한다.
// 기능 이동 전에는 features/·shared/ 규칙이 실제 코드에 걸리지 않으므로 이 시험이 그 규칙의 유일한 증거다.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROOT } from "../root";

let dir = "";
const write = (file: string, text: string) => {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
};

interface Violation {
  rule: { name: string; severity: string };
  from: string;
  to: string;
}

function cruise(): Violation[] {
  let stdout = "";
  try {
    stdout = execFileSync(
      process.execPath,
      [
        path.join(ROOT, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs"),
        "apps",
        "packages",
        "features",
        "shared",
        "--config",
        path.join(ROOT, ".dependency-cruiser.cjs"),
        "--output-type",
        "json",
      ],
      {
        cwd: dir,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    // 위반이 있으면 종료 코드가 0이 아니지만 stdout의 JSON은 정상이다
    stdout = (error as { stdout?: string }).stdout ?? "";
  }
  return (JSON.parse(stdout) as { summary: { violations: Violation[] } }).summary.violations;
}

let violations: Violation[] = [];
const has = (rule: string, from: string, to?: string) =>
  violations.some(
    (v) => v.rule.name === rule && v.from === from && (to === undefined || v.to === to),
  );

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "depcruise-fixture-"));
  fs.copyFileSync(path.join(ROOT, "tsconfig.base.json"), path.join(dir, "tsconfig.base.json"));
  fs.copyFileSync(
    path.join(ROOT, "tsconfig.depcruise.json"),
    path.join(dir, "tsconfig.depcruise.json"),
  );

  // 기능 a, b와 공통 영역
  write("features/b/src/index.ts", "export const b = 1;\n");
  write("features/a/src/index.ts", 'import { b } from "../../b/src/index";\nexport const a = b;\n');
  write(
    "features/a/src/ok.ts",
    'import { s } from "../../../shared/util";\nexport const ok = s;\n',
  );
  write("shared/util.ts", "export const s = 1;\n");
  write("shared/leak.ts", 'import { a } from "../features/a/src/index";\nexport const leak = a;\n');
  write("apps/web/z.ts", "export const z = 1;\n");
  write(
    "features/a/src/uses-app.ts",
    'import { z } from "../../../apps/web/z";\nexport const u = z;\n',
  );
  // apps 사이, packages → apps
  write("apps/worker/w.ts", "export const w = 1;\n");
  write("apps/web/uses-worker.ts", 'import { w } from "../worker/w";\nexport const x = w;\n');
  write(
    "packages/lib/src/uses-app.ts",
    'import { z } from "../../../apps/web/z";\nexport const p = z;\n',
  );
  // 도메인 순수성
  write("packages/db/src/client.ts", "export const db = 1;\n");
  write(
    "packages/core/src/bad.ts",
    'import { db } from "../../db/src/client";\nexport const bad = db;\n',
  );
  write("packages/core/src/good.ts", "export const good = 1;\n");
  // 값 순환은 잡고, 타입 전용 순환은 잡지 않는다
  write("features/a/src/c1.ts", 'import { c2 } from "./c2";\nexport const c1 = () => c2;\n');
  write("features/a/src/c2.ts", 'import { c1 } from "./c1";\nexport const c2 = () => c1;\n');
  write("features/a/src/t1.ts", 'import type { T2 } from "./t2";\nexport type T1 = { x: T2 };\n');
  write("features/a/src/t2.ts", 'import type { T1 } from "./t1";\nexport type T2 = { y: T1 };\n');
  // 프로덕션 → 테스트, 해석 안 되는 import
  write("features/a/src/prod.ts", 'import { t } from "./prod.test";\nexport const p = t;\n');
  write("features/a/src/prod.test.ts", "export const t = 1;\n");
  write(
    "features/a/src/missing.ts",
    'import { m } from "./does-not-exist";\nexport const mm = m;\n',
  );

  violations = cruise();
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("dependency-cruiser 규칙", () => {
  it("다른 기능을 import하면 no-cross-feature", () => {
    expect(has("no-cross-feature", "features/a/src/index.ts", "features/b/src/index.ts")).toBe(
      true,
    );
  });

  it("자기 기능과 shared만 import하면 위반이 없다", () => {
    expect(violations.some((v) => v.from === "features/a/src/ok.ts")).toBe(false);
  });

  it("공통 영역이 기능을 import하면 shared-must-not-import-features", () => {
    expect(has("shared-must-not-import-features", "shared/leak.ts")).toBe(true);
  });

  it("기능이 apps를 import하면 feature-imports-only-shared", () => {
    expect(has("feature-imports-only-shared", "features/a/src/uses-app.ts")).toBe(true);
  });

  it("apps끼리, packages→apps import는 막는다", () => {
    expect(has("apps-do-not-import-each-other", "apps/web/uses-worker.ts")).toBe(true);
    expect(has("packages-do-not-import-apps", "packages/lib/src/uses-app.ts")).toBe(true);
  });

  it("도메인(packages/core)이 db를 import하면 domain-is-pure", () => {
    expect(has("domain-is-pure", "packages/core/src/bad.ts")).toBe(true);
    expect(violations.some((v) => v.from === "packages/core/src/good.ts")).toBe(false);
  });

  it("값 순환은 잡고 타입 전용 순환은 잡지 않는다", () => {
    expect(
      violations.some((v) => v.rule.name === "no-circular" && /c1\.ts|c2\.ts/.test(v.from)),
    ).toBe(true);
    expect(
      violations.some((v) => /\/t1\.ts|\/t2\.ts/.test(v.from) && v.rule.name === "no-circular"),
    ).toBe(false);
  });

  it("프로덕션 코드가 테스트 파일을 import하면 no-test-in-production", () => {
    expect(has("no-test-in-production", "features/a/src/prod.ts")).toBe(true);
  });

  it("해석되지 않는 import는 not-to-unresolvable", () => {
    expect(has("not-to-unresolvable", "features/a/src/missing.ts")).toBe(true);
  });
});

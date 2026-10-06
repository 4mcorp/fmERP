// 생성한 Biome 경계 설정이 실제로 기능 간 import를 에디터·린트에서 잡는지 임시 폴더로 확인한다.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBoundaries, purityPaths } from "../boundaries";
import { ROOT, readJson } from "../root";

let dir = "";
const write = (file: string, text: string) => {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
};

function lint(file: string): string {
  try {
    return execFileSync(
      process.execPath,
      [
        path.join(ROOT, "node_modules/@biomejs/biome/bin/biome"),
        "lint",
        "--max-diagnostics=50",
        file,
      ],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "biome-boundaries-"));
  const pure = purityPaths(readJson(path.join(ROOT, "biome.json"), {}));
  write("biome.boundaries.json", buildBoundaries(["a", "b"], pure));
  write(
    "biome.json",
    JSON.stringify({ extends: ["./biome.boundaries.json"], linter: { rules: { preset: "none" } } }),
  );
  write("features/a/src/cross.ts", 'import { b } from "@fmerp/feature-b";\nexport const x = b;\n');
  write("features/a/src/self.ts", 'import { a } from "@fmerp/feature-a";\nexport const y = a;\n');
  write(
    "features/a/src/domain/impure.ts",
    'import { sql } from "drizzle-orm";\nexport const z = sql;\n',
  );
  write(
    "features/a/src/s3.ts",
    'import { S3Client } from "@aws-sdk/client-s3";\nexport const c = S3Client;\n',
  );
  write("shared/leak.ts", 'import { a } from "@fmerp/feature-a";\nexport const l = a;\n');
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Biome 경계 설정 생성", () => {
  it("다른 기능 패키지를 import하면 린트가 잡고, 자기 기능은 허용한다", () => {
    expect(lint("features/a/src/cross.ts")).toContain("다른 기능을 import하지 않는다");
    expect(lint("features/a/src/self.ts")).not.toContain("noRestrictedImports");
  });

  it("도메인 폴더에서 DB 라이브러리를 import하면 잡는다", () => {
    expect(lint("features/a/src/domain/impure.ts")).toContain("noRestrictedImports");
  });

  it("S3 SDK 직접 import는 기능 안에서 막는다", () => {
    expect(lint("features/a/src/s3.ts")).toContain("noRestrictedImports");
  });

  it("공통 영역이 기능을 import하면 잡는다", () => {
    expect(lint("shared/leak.ts")).toContain("공통 영역은 기능을 import하지 않는다");
  });

  it("출력은 결정적이다 (같은 입력, 같은 결과 — 생성 파일 최신 여부 검사의 전제)", () => {
    expect(buildBoundaries(["b", "a"], {})).toBe(buildBoundaries(["a", "b"], {}));
  });
});

// Biome 경계 규칙 생성기. 기능마다 "다른 기능 패키지를 import하지 않는다" 오버라이드를 만들어
// 에디터에서 바로 위반을 보이게 한다 (지정자 수준 — 해석된 경로 검사는 dependency-cruiser가 맡는다).
// 기능 목록은 features/*/package.json에서 읽으므로 기능을 추가하면 `pnpm arch:boundaries`로 다시 만든다.
import fs from "node:fs";
import path from "node:path";
import { ROOT, readJson } from "./root";

interface BiomeJson {
  overrides?: {
    includes: string[];
    linter?: {
      rules?: {
        style?: { noRestrictedImports?: { options?: { paths?: Record<string, unknown> } } };
      };
    };
  }[];
}

export const BOUNDARIES_FILE = path.join(ROOT, "biome.boundaries.json");

/** biome.json의 core 순수성 규칙(paths)을 그대로 가져온다 — 한 곳에서만 정의하기 위해 */
export function purityPaths(biome: BiomeJson): Record<string, unknown> {
  const core = biome.overrides?.find((o) => o.includes.includes("packages/core/**"));
  return core?.linter?.rules?.style?.noRestrictedImports?.options?.paths ?? {};
}

const S3_PATHS = {
  "@aws-sdk/client-s3":
    "S3는 @fmerp/storage 어댑터(이전 후 shared/storage)로만 접근한다 (docs/rules/storage-backup.md)",
  "@aws-sdk/s3-request-presigner":
    "S3는 @fmerp/storage 어댑터(이전 후 shared/storage)로만 접근한다",
};

const rule = (options: Record<string, unknown>) => ({
  linter: { rules: { style: { noRestrictedImports: { level: "error", options } } } },
});

/** 순수 함수: 기능 이름 목록과 순수성 규칙으로 biome.boundaries.json 내용을 만든다 */
export function buildBoundaries(features: string[], pure: Record<string, unknown>): string {
  const overrides: unknown[] = [];
  for (const name of [...features].sort()) {
    overrides.push({
      includes: [`features/${name}/**`],
      ...rule({
        paths: S3_PATHS,
        patterns: [
          {
            group: ["@fmerp/feature-*", `!@fmerp/feature-${name}`, `!@fmerp/feature-${name}/*`],
            message: `기능 '${name}'은 다른 기능을 import하지 않는다. shared로 올리거나 계약+주입, 이벤트를 쓴다 (docs/plan/2026-10-06-feature-architecture-refactor.md 3.2)`,
          },
          {
            group: ["@fmerp/tools", "@fmerp/web", "@fmerp/worker"],
            message: "기능은 합성 루트(apps)나 도구를 import하지 않는다",
          },
        ],
      }),
    });
    overrides.push({
      includes: [`features/${name}/src/domain/**`],
      ...rule({ paths: { ...S3_PATHS, ...pure } }),
    });
  }
  overrides.push({
    includes: ["shared/**"],
    ...rule({
      paths: S3_PATHS,
      patterns: [{ group: ["@fmerp/feature-*"], message: "공통 영역은 기능을 import하지 않는다" }],
    }),
  });
  overrides.push({ includes: ["shared/domain/**"], ...rule({ paths: { ...S3_PATHS, ...pure } }) });
  // 저장소 어댑터 자신은 S3 SDK를 쓸 수 있다
  overrides.push({ includes: ["shared/storage/**"], ...rule({ paths: {} }) });
  return `${JSON.stringify({ $schema: "./node_modules/@biomejs/biome/configuration_schema.json", overrides }, null, 2)}\n`;
}

function featureNames(): string[] {
  const dir = path.join(ROOT, "features");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "package.json")))
    .map((e) => e.name);
}

export function expectedBoundaries(): string {
  return buildBoundaries(
    featureNames(),
    purityPaths(readJson<BiomeJson>(path.join(ROOT, "biome.json"), {})),
  );
}

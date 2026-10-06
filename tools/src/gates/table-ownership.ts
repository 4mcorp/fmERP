// 테이블 소유권 (계획 3.4, P7): 스키마 @owner 주석, 기능의 표 접근(쓰기는 소유 표만, 읽기는 선언), 새 마이그레이션의 feature 태그.
import fs from "node:fs";
import path from "node:path";
import { git, ROOT } from "../root";
import {
  collectAccesses,
  evaluateOwnership,
  parseMapList,
  parseSchemaTables,
} from "../table-ownership";
import type { Gate } from "./types";

const SCHEMA_DIR = "packages/db/src/schema";
const MIGRATIONS_DIR = "packages/db/migrations";
/** 0021까지는 기능 태그 규칙 이전에 만들어졌다 */
const MIGRATION_EXEMPT_UP_TO = 21;

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

export const tableOwnershipGate: Gate = {
  name: "table-ownership",
  strict: true,
  description:
    "테이블 @owner 주석·기능의 표 접근(쓰기는 소유 표만, 읽기는 선언)·새 마이그레이션 feature 태그",
  async collect() {
    const tables = fs
      .readdirSync(path.join(ROOT, SCHEMA_DIR))
      .filter((f) => f.endsWith(".ts"))
      .flatMap((f) => parseSchemaTables(`${SCHEMA_DIR}/${f}`, read(`${SCHEMA_DIR}/${f}`)));
    const tableNames = new Set(tables.map((t) => t.exportName));

    const featuresDir = path.join(ROOT, "features");
    const features = fs.existsSync(featuresDir)
      ? fs
          .readdirSync(featuresDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      : [];

    const declared: Record<string, { reads: string[]; writes: string[] }> = {};
    for (const f of features) {
      const mapFile = path.join(featuresDir, f, "feature.map.yaml");
      const yaml = fs.existsSync(mapFile) ? fs.readFileSync(mapFile, "utf8") : "";
      declared[f] = { reads: parseMapList(yaml, "reads"), writes: parseMapList(yaml, "writes") };
    }

    const files = (
      await git(["ls-files", "--cached", "--others", "--exclude-standard", "features"])
    )
      .split("\n")
      .filter(
        (f) => /^features\/[^/]+\/src\/.*\.(ts|tsx)$/.test(f) && fs.existsSync(path.join(ROOT, f)),
      );
    const accesses = files.flatMap((file) => {
      const feature = /^features\/([^/]+)\//.exec(file)?.[1] ?? "";
      return collectAccesses(file, read(file), tableNames).map((access) => ({
        feature,
        file,
        access,
      }));
    });

    const migrations = fs
      .readdirSync(path.join(ROOT, MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .map((name) => ({
        name,
        firstLine: (read(`${MIGRATIONS_DIR}/${name}`).split("\n")[0] ?? "").trim(),
      }));

    return evaluateOwnership({
      tables,
      features,
      accesses,
      declared,
      migrations,
      migrationExemptUpTo: MIGRATION_EXEMPT_UP_TO,
    });
  },
};

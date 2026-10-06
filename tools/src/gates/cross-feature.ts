// 기능 간 결합(이전 전의 현재 위치 기준). 기능이 `features/*`로 옮겨지면 dependency-cruiser의 경로 규칙이
// 같은 일을 하므로, 이 게이트는 이전이 끝나는 단계(P10)에서 사라진다.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { type CruiseModule, cruise } from "../cruise";
import { isTestFile, ownerOf } from "../feature-assignment";
import { ROOT } from "../root";
import type { Gate } from "./types";

/** 저장소 안의 소스 (Node 내장·외부 패키지 제외) */
const inRepo = (source: string) => /^(apps|packages|tools|features|shared)\//.test(source);

const BARREL = /^packages\/[^/]+\/src\/index\.ts$/;

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(
    source,
    fs.readFileSync(path.join(ROOT, source), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

const specOf = (n: ts.Node | undefined) => (n && ts.isStringLiteral(n) ? n.text : null);

/** 배럴(`index.ts`)이 이름별로 어느 파일에서 내보내는지. 배럴을 거치면 실제 결합이 가려지므로 풀어서 본다 */
function barrelMap(mod: CruiseModule): Map<string, string> {
  const map = new Map<string, string>();
  for (const stmt of parse(mod.source).statements) {
    if (
      !ts.isExportDeclaration(stmt) ||
      !stmt.exportClause ||
      !ts.isNamedExports(stmt.exportClause)
    )
      continue;
    const spec = specOf(stmt.moduleSpecifier);
    const target = mod.dependencies.find((d) => d.module === spec)?.resolved;
    if (!target) continue;
    for (const el of stmt.exportClause.elements) map.set(el.name.text, target);
  }
  return map;
}

/** 이 파일이 `spec`에서 가져오는 이름들. 이름을 알 수 없는 import(`import *`, 기본값)면 `null` */
function importedNames(source: ts.SourceFile, spec: string): string[] | null {
  const names: string[] = [];
  let found = false;
  for (const stmt of source.statements) {
    if (ts.isImportDeclaration(stmt) && specOf(stmt.moduleSpecifier) === spec) {
      found = true;
      const clause = stmt.importClause;
      if (!clause) continue;
      if (clause.name) return null;
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) return null;
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements)
          names.push((el.propertyName ?? el.name).text);
      }
    } else if (ts.isExportDeclaration(stmt) && specOf(stmt.moduleSpecifier) === spec) {
      found = true;
      if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) return null;
      for (const el of stmt.exportClause.elements) names.push((el.propertyName ?? el.name).text);
    }
  }
  return found ? names : null;
}

export const crossFeatureGate: Gate = {
  name: "cross-feature",
  description: "기능 사이 import (공통·합성 루트 제외, 배럴은 이름 단위로 풀어서 측정)",
  async collect() {
    const { modules } = await cruise();
    const barrels = new Map<string, Map<string, string>>();
    for (const m of modules) if (BARREL.test(m.source)) barrels.set(m.source, barrelMap(m));

    const keys: string[] = [];
    for (const mod of modules) {
      if (!inRepo(mod.source) || isTestFile(mod.source)) continue;
      const from = ownerOf(mod.source);
      if (!from || from === "shared" || from === "composition") continue;
      const sf = parse(mod.source);
      for (const dep of mod.dependencies) {
        if (!dep.resolved || dep.resolved.includes("node_modules")) continue;
        let targets = [dep.resolved];
        const barrel = barrels.get(dep.resolved);
        if (barrel) {
          const files = importedNames(sf, dep.module)?.map((n) => barrel.get(n));
          if (files?.every((f): f is string => !!f)) targets = [...new Set(files)];
        }
        for (const target of targets) {
          if (isTestFile(target)) continue;
          const to = ownerOf(target);
          if (!to || to === "shared" || to === "composition" || to === from) continue;
          keys.push(`${mod.source} -> ${target}`);
        }
      }
    }
    return keys;
  },
};

/** 어느 기능에도 배정되지 않은 소스 파일. 새 파일은 반드시 배정되어야 한다 */
export const unassignedGate: Gate = {
  name: "unassigned-files",
  description: "tools/src/feature-assignment.ts에 규칙이 없는 소스 파일",
  async collect() {
    const { modules } = await cruise();
    return modules
      .filter((m) => inRepo(m.source) && !isTestFile(m.source) && !ownerOf(m.source))
      .map((m) => m.source);
  },
};

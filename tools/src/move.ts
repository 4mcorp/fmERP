// 파일 이동 + import 지정자 자동 수정 (기능 구조 전환 계획 6장: 이동은 기계적으로, 사람의 손수정을 줄인다).
// 이동 전의 위치로 모든 import를 해석해 두고, 이동한 뒤 새 위치 기준으로 지정자를 다시 쓴다.
// 대상: import/export from, 동적 import, `import("…")` 타입, vi.mock 류의 문자열.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const posix = (p: string) => p.split(path.sep).join("/");
const SOURCE = /\.(ts|tsx|mts|cts)$/;
const MOCKS = new Set(["mock", "doMock", "unmock", "importActual", "importMock"]);

interface Edit {
  /** 이동 전 경로(저장소 기준) */
  file: string;
  start: number;
  end: number;
  replacement: string;
}

export interface PlanResult {
  edits: Edit[];
  warnings: string[];
}

function tryFile(root: string, base: string): string | null {
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    const full = path.join(root, candidate);
    if (fs.existsSync(full) && fs.statSync(full).isFile() && SOURCE.test(candidate))
      return posix(candidate);
  }
  return null;
}

/** 지정자가 가리키는 저장소 안의 파일 (이동 전 기준). 외부 패키지·내장 모듈이면 null */
function resolveSpec(root: string, fromRel: string, spec: string): string | null {
  if (spec.startsWith("."))
    return tryFile(root, posix(path.posix.join(path.posix.dirname(fromRel), spec)));
  if (spec.startsWith("@/") && fromRel.startsWith("apps/web/")) {
    return tryFile(root, `apps/web/${spec.slice(2)}`);
  }
  if (spec.startsWith("@fmerp/shared/"))
    return tryFile(root, `shared/src/${spec.slice("@fmerp/shared/".length)}`);
  return null;
}

const stripExt = (p: string) => p.replace(/\.(ts|tsx|mts|cts)$/, "");

/** 새 위치 기준의 지정자. 원래 지정자의 모양(별칭/상대)을 가능한 한 유지한다 */
function specFor(
  newFrom: string,
  newTarget: string,
  original: string,
  targetIsIndex: boolean,
): string {
  let target = stripExt(newTarget);
  if (targetIsIndex && !/\/index$/.test(original)) target = target.replace(/\/index$/, "");
  const inShared = (p: string) => p.startsWith("shared/src/");
  if (inShared(newTarget) && !inShared(newFrom)) {
    return `@fmerp/shared/${target.slice("shared/src/".length)}`;
  }
  if (
    original.startsWith("@/") &&
    newFrom.startsWith("apps/web/") &&
    newTarget.startsWith("apps/web/")
  ) {
    return `@/${target.slice("apps/web/".length)}`;
  }
  let rel = posix(path.posix.relative(path.posix.dirname(newFrom), target));
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

function collect(sf: ts.SourceFile): { start: number; end: number; text: string }[] {
  const found: { start: number; end: number; text: string }[] = [];
  const add = (node: ts.Node | undefined) => {
    if (node && ts.isStringLiteralLike(node)) {
      found.push({ start: node.getStart(sf) + 1, end: node.getEnd() - 1, text: node.text });
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      add(node.argument.literal);
    else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const dynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const mock =
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "vi" &&
        MOCKS.has(callee.name.text);
      if (dynamicImport || mock) add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

export function planMoves(root: string, moves: Map<string, string>, files: string[]): PlanResult {
  const edits: Edit[] = [];
  const warnings: string[] = [];
  for (const file of files) {
    if (!SOURCE.test(file)) continue;
    const text = fs.readFileSync(path.join(root, file), "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const newFrom = moves.get(file) ?? file;
    for (const ref of collect(sf)) {
      const target = resolveSpec(root, file, ref.text);
      if (!target) continue;
      const newTarget = moves.get(target) ?? target;
      if (newFrom === file && newTarget === target) continue;
      const isIndex = /\/index\.tsx?$/.test(target);
      const replacement = specFor(newFrom, newTarget, ref.text, isIndex);
      if (newFrom.startsWith("shared/") && newTarget.startsWith("apps/")) {
        warnings.push(`${newFrom}: 공통 영역이 apps를 import합니다 → ${newTarget}`);
      }
      if (replacement !== ref.text)
        edits.push({ file, start: ref.start, end: ref.end, replacement });
    }
  }
  return { edits, warnings };
}

/** 이동하고 지정자를 고친다. `rename`은 git mv 같은 실제 이동 함수를 받는다(시험에서는 fs.rename) */
export function applyMoves(
  root: string,
  moves: Map<string, string>,
  files: string[],
  rename: (from: string, to: string) => void,
): PlanResult & { changed: string[] } {
  const plan = planMoves(root, moves, files);
  for (const [from, to] of moves) {
    fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
    rename(from, to);
  }
  const byFile = new Map<string, Edit[]>();
  for (const edit of plan.edits) byFile.set(edit.file, [...(byFile.get(edit.file) ?? []), edit]);
  const changed: string[] = [];
  for (const [file, list] of byFile) {
    const newPath = moves.get(file) ?? file;
    const full = path.join(root, newPath);
    let text = fs.readFileSync(full, "utf8");
    for (const edit of list.sort((a, b) => b.start - a.start)) {
      text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
    }
    fs.writeFileSync(full, text);
    changed.push(newPath);
  }
  for (const to of moves.values()) if (!changed.includes(to)) changed.push(to);
  return { ...plan, changed };
}

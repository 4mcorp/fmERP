// 테이블 소유권 검사의 순수한 부분 (계획 3.4). 실행·수집은 gates/table-ownership.ts가 한다.
//  - 스키마의 모든 테이블에 `@owner <기능|shared>` 주석이 있어야 한다.
//  - 기능 코드가 `schema.<테이블>`로 접근하는 것을 AST로 모아, 쓰기(insert·update·delete)는 소유 표·shared 표만,
//    읽기는 소유 표·shared 표와 feature.map.yaml의 `tables.reads`에 선언한 표만 허용한다.
//  - 새 마이그레이션은 첫 줄에 `-- feature: <이름>`을 둔다.
// 한계: `schema.<표>`로 드러나지 않는 접근(원시 SQL 문자열 등)은 보지 못한다.
import ts from "typescript";

export interface TableInfo {
  /** 스키마 export 이름 (`schema.<이름>`) */
  exportName: string;
  /** DB 표 이름 (snake_case) */
  sqlName: string;
  /** `@owner` 값. 주석이 없으면 null */
  owner: string | null;
  file: string;
}

/** 스키마 파일에서 pgTable 선언과 바로 앞 주석의 `@owner`를 읽는다 */
export function parseSchemaTables(file: string, source: string): TableInfo[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const tables: TableInfo[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      const init = decl.initializer;
      if (
        !init ||
        !ts.isCallExpression(init) ||
        !ts.isIdentifier(init.expression) ||
        init.expression.text !== "pgTable" ||
        !ts.isIdentifier(decl.name)
      )
        continue;
      const nameArg = init.arguments[0];
      if (!nameArg || !ts.isStringLiteral(nameArg)) continue;
      const leading = source.slice(stmt.getFullStart(), stmt.getStart());
      const owner = /@owner\s+([a-z][a-z-]*)/.exec(leading)?.[1] ?? null;
      tables.push({ exportName: decl.name.text, sqlName: nameArg.text, owner, file });
    }
  }
  return tables;
}

export interface TableAccess {
  exportName: string;
  kind: "read" | "write";
}

const WRITE_CALLS = new Set(["insert", "update", "delete"]);

/** 한 파일의 `schema.<표>` 접근. 같은 파일 안의 `const A = schema.표` 별칭도 따라간다 */
export function collectAccesses(file: string, source: string, tables: Set<string>): TableAccess[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const aliases = new Map<string, string>();
  const out: TableAccess[] = [];

  const tableOf = (node: ts.Node): string | null => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "schema" &&
      tables.has(node.name.text)
    )
      return node.name.text;
    return null;
  };

  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const t = tableOf(node.initializer);
      if (t) {
        aliases.set(node.name.text, t);
        out.push({ exportName: t, kind: "read" });
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      const t = tableOf(node);
      // `const A = schema.x`의 오른쪽은 위에서 읽기로 셌다. 그 밖의 `schema.x` 접근은 여기서 센다
      if (t && !(ts.isVariableDeclaration(node.parent) && node.parent.initializer === node)) {
        const call = node.parent;
        const isWrite =
          ts.isCallExpression(call) &&
          call.arguments[0] === node &&
          ts.isPropertyAccessExpression(call.expression) &&
          WRITE_CALLS.has(call.expression.name.text);
        out.push({ exportName: t, kind: isWrite ? "write" : "read" });
      }
    }
    // `.insert(A)`처럼 별칭을 인자로 쓰는 쓰기
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      WRITE_CALLS.has(node.expression.name.text)
    ) {
      const arg = node.arguments[0];
      const aliased = arg && ts.isIdentifier(arg) ? aliases.get(arg.text) : undefined;
      if (aliased) out.push({ exportName: aliased, kind: "write" });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** feature.map.yaml의 한 줄 목록(`reads: [a, b]`)을 읽는다. 없으면 빈 목록 */
export function parseMapList(yaml: string, key: "reads" | "writes"): string[] {
  const m = new RegExp(`^\\s*${key}:\\s*\\[([^\\]]*)\\]`, "m").exec(yaml);
  if (!m?.[1]) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface OwnershipInput {
  tables: TableInfo[];
  /** 기능 이름 목록 (features/ 폴더) */
  features: string[];
  /** 기능 코드의 접근. feature는 파일이 속한 기능 */
  accesses: { feature: string; file: string; access: TableAccess }[];
  /** 기능별 feature.map.yaml의 tables.reads·writes 선언 (DB 표 이름) */
  declared: Record<string, { reads: string[]; writes: string[] }>;
  /** 마이그레이션 파일 이름과 첫 줄 */
  migrations: { name: string; firstLine: string }[];
  /** 이 번호 이하의 마이그레이션은 태그 규칙을 소급하지 않는다 */
  migrationExemptUpTo: number;
}

/** 위반 키 목록 (정렬·중복 제거 전) */
export function evaluateOwnership(input: OwnershipInput): string[] {
  const keys: string[] = [];
  const byExport = new Map(input.tables.map((t) => [t.exportName, t]));
  const owners = new Set([...input.features, "shared"]);

  for (const t of input.tables) {
    if (t.owner === null) keys.push(`missing-owner:${t.sqlName}`);
    else if (!owners.has(t.owner)) keys.push(`bad-owner:${t.sqlName}:${t.owner}`);
  }

  for (const { feature, access } of input.accesses) {
    const table = byExport.get(access.exportName);
    if (!table?.owner) continue;
    const own = table.owner === feature || table.owner === "shared";
    const decl = input.declared[feature] ?? { reads: [], writes: [] };
    if (access.kind === "write") {
      if (!own && !decl.writes.includes(table.sqlName)) {
        keys.push(`write:${feature}:${table.sqlName}`);
      }
    } else if (
      !own &&
      !decl.reads.includes(table.sqlName) &&
      !decl.writes.includes(table.sqlName)
    ) {
      keys.push(`read:${feature}:${table.sqlName}`);
    }
  }

  for (const m of input.migrations) {
    const num = Number.parseInt(m.name.slice(0, 4), 10);
    if (Number.isNaN(num) || num <= input.migrationExemptUpTo) continue;
    const tag = /^--\s*feature:\s*([a-z][a-z-]*)\s*$/.exec(m.firstLine)?.[1];
    if (!tag || !owners.has(tag)) keys.push(`migration-tag:${m.name}`);
  }
  return keys;
}

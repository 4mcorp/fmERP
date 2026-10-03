/** 부서 CSV 내보내기·가져오기 (PRD ORG-016). 순수 함수 — DB 반영은 호출 쪽이 한다. */

export const MAX_IMPORT_ROWS = 500;

/** RFC 4180 수준의 CSV 파서 (따옴표, 쉼표·줄바꿈 포함 값, BOM) */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** 엑셀이 수식으로 실행할 수 있는 시작 문자 앞에 작은따옴표를 붙이고, 필요하면 따옴표로 감싼다 */
function escapeCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export interface DepartmentCsvRow {
  code: string;
  name: string;
  parentCode: string | null;
  shortName: string | null;
  sort: number;
}

export function departmentsToCsv(rows: DepartmentCsvRow[]): string {
  const lines = ["code,name,parentCode,shortName,sort"];
  for (const r of rows) {
    lines.push(
      [r.code, r.name, r.parentCode ?? "", r.shortName ?? "", String(r.sort)]
        .map(escapeCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export interface PlannedDepartment {
  code: string;
  name: string;
  parentCode: string | null;
  shortName: string | null;
  sort: number;
  depth: number;
  line: number;
}

export type ImportPlan =
  | { ok: true; creates: PlannedDepartment[] }
  | { ok: false; errors: { line: number; message: string }[] };

/**
 * CSV로 만들 부서 목록을 상위 → 하위 순서로 정한다. 오류는 줄 번호와 함께 모두 모아 돌려준다.
 * 이미 있는 부서 코드는 새로 만들지 않고 거부한다. 상위 부서는 기존 부서나 CSV 안의 부서를 코드로 가리킨다.
 */
export function planDepartmentImport(input: {
  csv: string;
  existing: { code: string; depth: number }[];
  maxDepth: number;
}): ImportPlan {
  const table = parseCsv(input.csv).filter((r) => r.some((c) => c.trim() !== ""));
  const [header, ...body] = table;
  if (!header) return { ok: false, errors: [{ line: 1, message: "내용이 비어 있습니다" }] };
  const col = (name: string) => header.map((h) => h.trim()).indexOf(name);
  const iCode = col("code");
  const iName = col("name");
  if (iCode < 0 || iName < 0) {
    return { ok: false, errors: [{ line: 1, message: "code, name 열이 필요합니다" }] };
  }
  if (body.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      errors: [{ line: 1, message: `한 번에 ${MAX_IMPORT_ROWS}행까지 가져올 수 있습니다` }],
    };
  }
  const iParent = col("parentCode");
  const iShort = col("shortName");
  const iSort = col("sort");

  const errors: { line: number; message: string }[] = [];
  const existing = new Map(input.existing.map((e) => [e.code, e.depth]));
  const rows = new Map<string, PlannedDepartment>();
  body.forEach((cells, index) => {
    const line = index + 2;
    const get = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
    const code = get(iCode);
    const name = get(iName);
    if (!code || !name) {
      errors.push({ line, message: "부서 코드와 부서명은 필수입니다" });
      return;
    }
    if (existing.has(code)) {
      errors.push({ line, message: `이미 있는 부서 코드입니다: ${code}` });
      return;
    }
    if (rows.has(code)) {
      errors.push({ line, message: `CSV 안에서 중복된 부서 코드입니다: ${code}` });
      return;
    }
    const sort = Number.parseInt(get(iSort) || "0", 10);
    rows.set(code, {
      code,
      name,
      parentCode: get(iParent) || null,
      shortName: get(iShort) || null,
      sort: Number.isFinite(sort) ? sort : 0,
      depth: 0,
      line,
    });
  });

  // 깊이 계산: 상위를 따라 올라가며 기존 부서에 닿거나 최상위에 닿을 때까지
  const resolved = new Map<string, number>();
  const failed = new Set<string>();
  for (const start of rows.values()) {
    if (resolved.has(start.code) || failed.has(start.code)) continue;
    const chain: PlannedDepartment[] = [];
    const seen = new Set<string>();
    let cursor: PlannedDepartment | undefined = start;
    let baseDepth = 0;
    let problem: string | null = null;
    while (cursor) {
      if (seen.has(cursor.code)) {
        problem = "상위 부서 지정이 순환합니다";
        break;
      }
      seen.add(cursor.code);
      chain.push(cursor);
      if (cursor.parentCode === null) break;
      const parentCode: string = cursor.parentCode;
      if (resolved.has(parentCode)) {
        baseDepth = resolved.get(parentCode) as number;
        break;
      }
      if (existing.has(parentCode)) {
        baseDepth = existing.get(parentCode) as number;
        break;
      }
      const next = rows.get(parentCode);
      if (!next || failed.has(parentCode)) {
        problem = next
          ? "상위 부서에 오류가 있습니다"
          : `상위 부서 코드를 찾을 수 없습니다: ${parentCode}`;
        break;
      }
      cursor = next;
    }
    if (problem) {
      for (const c of chain) {
        failed.add(c.code);
        errors.push({ line: c.line, message: problem });
      }
      continue;
    }
    let depth = baseDepth;
    for (const c of chain.reverse()) {
      depth += 1;
      c.depth = depth;
      resolved.set(c.code, depth);
      if (depth > input.maxDepth) {
        errors.push({
          line: c.line,
          message: `최대 ${input.maxDepth}단계를 넘습니다 (${depth}단계)`,
        });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors: errors.sort((a, b) => a.line - b.line) };
  const creates = [...rows.values()].sort((a, b) => a.depth - b.depth || a.line - b.line);
  return { ok: true, creates };
}

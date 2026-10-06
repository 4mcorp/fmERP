import { describe, expect, it } from "vitest";
import { departmentsToCsv, parseCsv, planDepartmentImport } from "../src/domain/department-csv";

describe("CSV 파싱", () => {
  it("따옴표·쉼표·줄바꿈·BOM을 처리한다", () => {
    const rows = parseCsv('﻿code,name\r\nA,"가, 나"\r\nB,"큰따옴표 "" 포함"\n');
    expect(rows).toEqual([
      ["code", "name"],
      ["A", "가, 나"],
      ["B", '큰따옴표 " 포함'],
    ]);
  });
});

describe("부서 CSV 내보내기", () => {
  it("코드·이름·상위 코드·약칭·정렬을 출력하고 값을 이스케이프한다", () => {
    const csv = departmentsToCsv([
      { code: "MGT", name: "경영, 지원", parentCode: null, shortName: null, sort: 0 },
      { code: "FIN", name: "재무팀", parentCode: "MGT", shortName: "재무", sort: 1 },
    ]);
    expect(csv).toBe(
      [
        "code,name,parentCode,shortName,sort",
        'MGT,"경영, 지원",,,0',
        "FIN,재무팀,MGT,재무,1",
        "",
      ].join("\n"),
    );
  });

  it("엑셀이 수식으로 해석할 수 있는 시작 문자는 앞에 작은따옴표를 붙인다", () => {
    const csv = departmentsToCsv([
      { code: "X", name: "=SUM(A1)", parentCode: null, shortName: null, sort: 0 },
    ]);
    expect(csv).toContain("'=SUM(A1)");
  });
});

describe("부서 CSV 가져오기 계획 (ORG-016)", () => {
  const existing = [{ code: "MGT", depth: 1 }];

  it("상위 코드가 뒤에 나와도 순서를 정해 생성 목록을 만든다", () => {
    const csv = "code,name,parentCode,shortName,sort\nCASH,자금파트,FIN,,0\nFIN,재무팀,MGT,,1\n";
    const result = planDepartmentImport({ csv, existing, maxDepth: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.creates.map((c) => [c.code, c.parentCode, c.depth])).toEqual([
        ["FIN", "MGT", 2],
        ["CASH", "FIN", 3],
      ]);
    }
  });

  it("뎁스 초과·중복 코드·없는 상위·순환을 줄 번호와 함께 모두 보고한다", () => {
    const csv = [
      "code,name,parentCode,shortName,sort",
      "A,가,MGT,,0", // 2단계
      "B,나,A,,0", // 3단계
      "C,다,B,,0", // 4단계 → 초과
      "MGT,중복,,,0", // 이미 있는 코드
      "D,라,NOPE,,0", // 없는 상위
      "E,마,F,,0",
      "F,바,E,,0", // 순환
      "A,또중복,,,0", // CSV 안 중복
    ].join("\n");
    const result = planDepartmentImport({ csv, existing, maxDepth: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const byLine = Object.fromEntries(result.errors.map((e) => [e.line, e.message]));
      expect(byLine[4]).toMatch(/최대 3단계/);
      expect(byLine[5]).toMatch(/이미 있는 부서 코드/);
      expect(byLine[6]).toMatch(/상위 부서 코드/);
      expect(byLine[7]).toMatch(/순환/);
      expect(byLine[9]).toMatch(/CSV 안에서 중복/);
    }
  });

  it("필수 열이 없거나 값이 비면 거부한다", () => {
    expect(planDepartmentImport({ csv: "code,title\nA,가", existing, maxDepth: 3 }).ok).toBe(false);
    const r = planDepartmentImport({ csv: "code,name\n,이름만", existing, maxDepth: 3 });
    expect(r.ok).toBe(false);
  });

  it("행이 너무 많으면 거부한다", () => {
    const rows = Array.from({ length: 501 }, (_, i) => `D${i},부서${i}`).join("\n");
    const r = planDepartmentImport({ csv: `code,name\n${rows}`, existing: [], maxDepth: 5 });
    expect(r.ok).toBe(false);
  });
});

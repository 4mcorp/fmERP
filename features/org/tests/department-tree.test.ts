import { describe, expect, it } from "vitest";
import {
  checkCreateDepartment,
  checkMaxDepthChange,
  checkMoveDepartment,
  type DeptNode,
  departmentPath,
} from "../src/domain/department-tree";

// 경영지원본부(1) > 재무팀(2) > 자금파트(3), 경영지원본부 > 인사팀(2), 영업본부(1)
const nodes: DeptNode[] = [
  { id: "hq", parentId: null, depth: 1 },
  { id: "fin", parentId: "hq", depth: 2 },
  { id: "cash", parentId: "fin", depth: 3 },
  { id: "hr", parentId: "hq", depth: 2 },
  { id: "sales", parentId: null, depth: 1 },
];

describe("부서 생성 (PRD ORG-010·011, S2)", () => {
  it("최상위 부서는 뎁스 1이다", () => {
    expect(checkCreateDepartment({ parentDepth: null, maxDepth: 1 })).toEqual({
      ok: true,
      depth: 1,
    });
  });

  it("부모 뎁스 + 1이 최대 뎁스 이하면 허용한다", () => {
    expect(checkCreateDepartment({ parentDepth: 2, maxDepth: 3 })).toEqual({ ok: true, depth: 3 });
  });

  it("최대 뎁스를 넘으면 안내 문구와 함께 거부한다", () => {
    expect(checkCreateDepartment({ parentDepth: 3, maxDepth: 3 })).toEqual({
      ok: false,
      reason: "최대 3단계까지 만들 수 있습니다",
    });
  });
});

describe("최대 뎁스 변경 (PRD ORG-012, S2)", () => {
  it("높이는 것은 언제든 허용한다", () => {
    expect(checkMaxDepthChange(nodes, 5)).toEqual({ ok: true });
  });

  it("낮출 때 새 값을 넘는 부서가 없으면 허용한다", () => {
    expect(checkMaxDepthChange(nodes, 3)).toEqual({ ok: true });
  });

  it("넘는 부서가 있으면 그 목록과 함께 거부한다", () => {
    expect(checkMaxDepthChange(nodes, 2)).toEqual({ ok: false, exceeding: ["cash"] });
    const result = checkMaxDepthChange(nodes, 1);
    expect(result).toEqual({ ok: false, exceeding: ["fin", "cash", "hr"] });
  });
});

describe("부서 이동 (PRD ORG-013, S2)", () => {
  it("하위 트리 최대 뎁스가 한도 이내면 허용하고 뎁스 변화를 돌려준다", () => {
    const result = checkMoveDepartment({ nodes, id: "cash", newParentId: "sales", maxDepth: 3 });
    expect(result).toEqual({ ok: true, depthDelta: -1 });
  });

  it("S2: 재무팀(하위 1단계 포함)을 다른 2단계 부서 아래로 옮기면 뎁스 4가 되어 거부한다", () => {
    const result = checkMoveDepartment({ nodes, id: "fin", newParentId: "hr", maxDepth: 3 });
    expect(result).toEqual({ ok: false, reason: "이동하면 4단계가 되어 최대 3단계를 넘습니다" });
  });

  it("자기 자신이나 자기 하위 부서 아래로는 옮길 수 없다", () => {
    expect(checkMoveDepartment({ nodes, id: "fin", newParentId: "fin", maxDepth: 5 }).ok).toBe(
      false,
    );
    expect(checkMoveDepartment({ nodes, id: "hq", newParentId: "cash", maxDepth: 5 }).ok).toBe(
      false,
    );
  });

  it("최상위로 옮길 수 있다 (newParentId null)", () => {
    expect(checkMoveDepartment({ nodes, id: "fin", newParentId: null, maxDepth: 3 })).toEqual({
      ok: true,
      depthDelta: -1,
    });
  });

  it("없는 부서는 거부한다", () => {
    expect(checkMoveDepartment({ nodes, id: "x", newParentId: null, maxDepth: 3 }).ok).toBe(false);
    expect(checkMoveDepartment({ nodes, id: "fin", newParentId: "x", maxDepth: 3 }).ok).toBe(false);
  });
});

describe("부서 경로", () => {
  it("부모 경로 뒤에 자기 id를 붙인다", () => {
    expect(departmentPath(null, "a")).toBe("a");
    expect(departmentPath("a/b", "c")).toBe("a/b/c");
  });
});

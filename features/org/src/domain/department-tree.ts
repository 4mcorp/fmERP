/** 부서 트리 규칙 (PRD ORG-010~013). 뎁스 1은 사업자 바로 아래 부서다. */
export interface DeptNode {
  id: string;
  parentId: string | null;
  depth: number;
}

export type CreateDepartmentCheck = { ok: true; depth: number } | { ok: false; reason: string };

export function checkCreateDepartment(input: {
  parentDepth: number | null;
  maxDepth: number;
}): CreateDepartmentCheck {
  const depth = (input.parentDepth ?? 0) + 1;
  if (depth > input.maxDepth) {
    return { ok: false, reason: `최대 ${input.maxDepth}단계까지 만들 수 있습니다` };
  }
  return { ok: true, depth };
}

export type MaxDepthCheck = { ok: true } | { ok: false; exceeding: string[] };

/** 최대 뎁스를 바꿀 수 있는지 확인한다. 낮출 때 새 값을 넘는 부서 id 목록을 돌려준다 (ORG-012). */
export function checkMaxDepthChange(nodes: DeptNode[], newMax: number): MaxDepthCheck {
  const exceeding = nodes.filter((n) => n.depth > newMax).map((n) => n.id);
  return exceeding.length === 0 ? { ok: true } : { ok: false, exceeding };
}

export type MoveCheck = { ok: true; depthDelta: number } | { ok: false; reason: string };

/** 부서 이동이 가능한지 확인한다. 이동 후 하위 트리의 최대 뎁스가 한도를 넘으면 거부한다 (ORG-013). */
export function checkMoveDepartment(input: {
  nodes: DeptNode[];
  id: string;
  newParentId: string | null;
  maxDepth: number;
}): MoveCheck {
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const moving = byId.get(input.id);
  if (!moving) return { ok: false, reason: "부서를 찾을 수 없습니다" };

  let newParentDepth = 0;
  if (input.newParentId !== null) {
    const parent = byId.get(input.newParentId);
    if (!parent) return { ok: false, reason: "상위 부서를 찾을 수 없습니다" };
    // 자기 자신 또는 자기 하위로 옮기면 순환이 생긴다
    for (
      let cursor: DeptNode | undefined = parent;
      cursor;
      cursor = byId.get(cursor.parentId ?? "")
    ) {
      if (cursor.id === moving.id) {
        return { ok: false, reason: "자기 자신이나 하위 부서 아래로는 옮길 수 없습니다" };
      }
    }
    newParentDepth = parent.depth;
  }

  const depthDelta = newParentDepth + 1 - moving.depth;
  const subtree = input.nodes.filter((n) => isSelfOrDescendant(n, moving.id, byId));
  const deepest = Math.max(...subtree.map((n) => n.depth)) + depthDelta;
  if (deepest > input.maxDepth) {
    return {
      ok: false,
      reason: `이동하면 ${deepest}단계가 되어 최대 ${input.maxDepth}단계를 넘습니다`,
    };
  }
  return { ok: true, depthDelta };
}

function isSelfOrDescendant(node: DeptNode, rootId: string, byId: Map<string, DeptNode>): boolean {
  for (let cursor: DeptNode | undefined = node; cursor; cursor = byId.get(cursor.parentId ?? "")) {
    if (cursor.id === rootId) return true;
  }
  return false;
}

/** 구체화 경로: 조상 id를 `/`로 이어 붙인다. 하위 트리는 `path LIKE '<path>/%'`로 찾는다. */
export function departmentPath(parentPath: string | null, id: string): string {
  return parentPath ? `${parentPath}/${id}` : id;
}

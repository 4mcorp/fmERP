import type { Department } from "./types";

export interface DeptTreeNode extends Department {
  children: DeptTreeNode[];
}

/** 평면 부서 목록을 트리로 만든다. 정렬은 입력 순서(뎁스·정렬·코드)를 따른다 */
export function buildDeptTree(list: Department[]): DeptTreeNode[] {
  const nodes = new Map(list.map((d) => [d.id, { ...d, children: [] as DeptTreeNode[] }]));
  const roots: DeptTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (items: DeptTreeNode[]) => {
    items.sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
    for (const i of items) sort(i.children);
  };
  sort(roots);
  return roots;
}

/** 검색어와 맞는 부서와 그 상위 부서만 남긴다. 검색어가 없으면 그대로 */
export function filterDeptTree(nodes: DeptTreeNode[], query: string): DeptTreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  const walk = (items: DeptTreeNode[]): DeptTreeNode[] =>
    items.flatMap((n) => {
      const children = walk(n.children);
      const hit = [n.name, n.code, n.shortName ?? ""].some((v) => v.toLowerCase().includes(q));
      return hit || children.length > 0 ? [{ ...n, children: hit ? n.children : children }] : [];
    });
  return walk(nodes);
}

/** 하위 부서까지 합친 구성원 수 */
export function totalMembers(node: DeptTreeNode): number {
  return node.memberCount + node.children.reduce((sum, c) => sum + totalMembers(c), 0);
}

/** DataTable의 순수 계산(검색·필터·정렬·페이지·선택 정리). 화면 의존이 없어 단위 시험한다 */

export type SortDir = "asc" | "desc";
export type SortState = { id: string; dir: SortDir } | null;
type SortValue = string | number | null;

/** 정렬 순환: 없음 → 오름 → 내림 → 없음 */
export function nextSort(current: SortState, id: string): SortState {
  if (!current || current.id !== id) return { id, dir: "asc" };
  if (current.dir === "asc") return { id, dir: "desc" };
  return null;
}

/** `null`은 방향과 무관하게 항상 끝. 같은 값이면 원래 순서를 유지한다(안정 정렬) */
export function sortRows<T>(rows: T[], sortValue: (row: T) => SortValue, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      let cmp: number;
      if (typeof a.value === "number" && typeof b.value === "number") cmp = a.value - b.value;
      else cmp = String(a.value).localeCompare(String(b.value), "ko");
      return cmp === 0 ? a.index - b.index : cmp * sign;
    })
    .map((x) => x.row);
}

/** 대소문자 무시 부분 일치. 빈 검색어는 전부 통과 */
export function matchesSearch(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || text.toLowerCase().includes(q);
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** 범위를 벗어난 페이지(1부터)를 유효 범위로 맞춘다 */
export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, page), pageCount(total, pageSize));
}

export function slicePage<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = (clampPage(page, rows.length, pageSize) - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

/** 더 이상 존재하지 않는 키를 선택 집합에서 제거. 변화가 없으면 같은 Set을 돌려준다 */
export function pruneSelection(selected: Set<string>, existingKeys: Set<string>): Set<string> {
  let changed = false;
  const next = new Set<string>();
  for (const key of selected) {
    if (existingKeys.has(key)) next.add(key);
    else changed = true;
  }
  return changed ? next : selected;
}

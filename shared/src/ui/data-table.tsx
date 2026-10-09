"use client";

import { cn } from "cn";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./button";
import {
  clampPage,
  matchesSearch,
  nextSort,
  pageCount,
  pruneSelection,
  type SortState,
  slicePage,
  sortRows,
} from "./data-table-logic";
import { Input } from "./input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

export type DataTableColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** 있으면 정렬 가능 열 */
  sortValue?: (row: T) => string | number | null;
  /** 숫자·금액 열은 right (tabular-nums 자동 적용) */
  align?: "left" | "right";
  className?: string;
  /** 이 너비 미만에서 열 숨김 */
  hideBelow?: "sm" | "md";
};

export type DataTableFilter<T> = {
  id: string;
  label: string;
  allLabel: string;
  options: { value: string; label: string }[];
  predicate: (row: T, value: string) => boolean;
};

export type DataTableProps<T> = {
  rows: T[];
  columns: DataTableColumn<T>[];
  rowKey: (row: T) => string;
  /** sr-only <caption>. 접근성 필수 */
  caption: string;
  isLoading?: boolean;
  empty?: ReactNode;
  search?: { placeholder: string; text: (row: T) => string };
  filters?: DataTableFilter<T>[];
  selectable?: boolean;
  selectLabel?: (row: T) => string;
  bulkActions?: (selected: T[], clear: () => void) => ReactNode;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  toolbarEnd?: ReactNode;
  className?: string;
};

const ALL = "__all__";
const PAGE_SIZES = [10, 20, 50];
const HIDE_CLASS = { sm: "hidden sm:table-cell", md: "hidden md:table-cell" } as const;

function colClass<T>(col: DataTableColumn<T>) {
  return cn(
    col.align === "right" && "text-right tabular-nums",
    col.hideBelow && HIDE_CLASS[col.hideBelow],
    col.className,
  );
}

function SortIcon({ dir }: { dir: "asc" | "desc" | null }) {
  const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ChevronsUpDown;
  return <Icon aria-hidden className="size-3.5" />;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  caption,
  isLoading = false,
  empty,
  search,
  filters = [],
  selectable = false,
  selectLabel,
  bulkActions,
  pageSize: initialPageSize = 20,
  onRowClick,
  toolbarEnd,
  className,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const activeFilters = Object.values(filterValues).some((v) => v !== ALL && v !== undefined);
  const isFiltered = query.trim() !== "" || activeFilters;

  const filtered = useMemo(() => {
    let out = rows;
    if (search && query.trim() !== "") {
      out = out.filter((r) => matchesSearch(search.text(r), query));
    }
    for (const f of filters) {
      const v = filterValues[f.id];
      if (v !== undefined && v !== ALL) out = out.filter((r) => f.predicate(r, v));
    }
    return out;
  }, [rows, search, query, filters, filterValues]);

  const sorted = useMemo(() => {
    const col = sort ? columns.find((c) => c.id === sort.id) : undefined;
    return sort && col?.sortValue ? sortRows(filtered, col.sortValue, sort.dir) : filtered;
  }, [filtered, sort, columns]);

  const currentPage = clampPage(page, sorted.length, pageSize);
  const pageRows = useMemo(
    () => slicePage(sorted, currentPage, pageSize),
    [sorted, currentPage, pageSize],
  );
  const totalPages = pageCount(sorted.length, pageSize);

  // 사라진 행의 선택은 제거한다
  useEffect(() => {
    if (!selectable) return;
    setSelected((prev) => pruneSelection(prev, new Set(rows.map(rowKey))));
  }, [selectable, rows, rowKey]);

  const pageKeys = pageRows.map(rowKey);
  const selectedOnPage = pageKeys.filter((k) => selected.has(k)).length;
  const allOnPage = pageKeys.length > 0 && selectedOnPage === pageKeys.length;
  const headerCheckbox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckbox.current) {
      headerCheckbox.current.indeterminate = selectedOnPage > 0 && !allOnPage;
    }
  }, [selectedOnPage, allOnPage]);

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(rowKey(r))),
    [rows, selected, rowKey],
  );
  const clearSelection = () => setSelected(new Set());

  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of pageKeys) {
        if (allOnPage) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function resetFilters() {
    setQuery("");
    setFilterValues({});
    setPage(1);
  }

  const colCount = columns.length + (selectable ? 1 : 0);
  const showBulk = selectable && selectedRows.length > 0;

  return (
    <div className={className}>
      {showBulk ? (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted px-3 py-2 text-sm"
        >
          <span>{selectedRows.length}건 선택됨</span>
          {bulkActions?.(selectedRows, clearSelection)}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={clearSelection}>
            선택 해제
          </Button>
        </div>
      ) : (
        (search || filters.length > 0 || toolbarEnd) && (
          <div className="flex flex-wrap items-center gap-2 pb-3">
            {search && (
              <Input
                type="search"
                aria-label={search.placeholder}
                placeholder={search.placeholder}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                className="w-full sm:w-64"
              />
            )}
            {filters.map((f) => (
              <Select
                key={f.id}
                value={filterValues[f.id] ?? ALL}
                onValueChange={(v) => {
                  setFilterValues((prev) => ({ ...prev, [f.id]: v }));
                  setPage(1);
                }}
              >
                <SelectTrigger aria-label={f.label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{f.allLabel}</SelectItem>
                  {f.options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ))}
            {isFiltered && (
              <Button variant="link" size="sm" onClick={resetFilters}>
                초기화
              </Button>
            )}
            {toolbarEnd && <div className="ml-auto flex items-center gap-2">{toolbarEnd}</div>}
          </div>
        )
      )}

      <div className="rounded-lg border">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader className="bg-muted/50 text-xs font-medium text-muted-foreground">
            <TableRow>
              {selectable && (
                <TableHead className="w-10">
                  <input
                    ref={headerCheckbox}
                    type="checkbox"
                    className="size-4 accent-primary"
                    aria-label="현재 페이지 전체 선택"
                    checked={allOnPage}
                    disabled={pageKeys.length === 0}
                    onChange={togglePage}
                  />
                </TableHead>
              )}
              {columns.map((col) => {
                const dir = sort?.id === col.id ? sort.dir : null;
                return (
                  <TableHead
                    key={col.id}
                    className={colClass(col)}
                    aria-sort={
                      col.sortValue
                        ? dir === "asc"
                          ? "ascending"
                          : dir === "desc"
                            ? "descending"
                            : "none"
                        : undefined
                    }
                  >
                    {col.sortValue ? (
                      <button
                        type="button"
                        aria-label={`${col.header} 정렬`}
                        onClick={() => setSort((s) => nextSort(s, col.id))}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                          col.align === "right" && "flex-row-reverse",
                        )}
                      >
                        {col.header}
                        <SortIcon dir={dir} />
                      </button>
                    ) : (
                      col.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody aria-busy={isLoading || undefined}>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={colCount}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  불러오는 중…
                </TableCell>
              </TableRow>
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="text-center">
                  {isFiltered ? (
                    <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
                      <p>조건에 맞는 항목이 없습니다</p>
                      <Button variant="outline" size="sm" onClick={resetFilters}>
                        필터 초기화
                      </Button>
                    </div>
                  ) : (
                    (empty ?? (
                      <div className="py-12 text-center text-sm text-muted-foreground">
                        표시할 항목이 없습니다
                      </div>
                    ))
                  )}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((row) => {
                const key = rowKey(row);
                const isSelected = selected.has(key);
                return (
                  <TableRow
                    key={key}
                    data-state={isSelected ? "selected" : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn("hover:bg-muted/50", onRowClick && "cursor-pointer")}
                  >
                    {selectable && (
                      <TableCell className="w-10 px-3 py-3 sm:py-2.5">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          aria-label={selectLabel?.(row) ?? "행 선택"}
                          checked={isSelected}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleRow(key)}
                        />
                      </TableCell>
                    )}
                    {columns.map((col) => (
                      <TableCell
                        key={col.id}
                        className={cn("px-3 py-3 text-sm sm:py-2.5", colClass(col))}
                      >
                        {col.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {!isLoading && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-sm">
          <span className="text-muted-foreground">총 {sorted.length}건</span>
          {sorted.length > pageSize && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">페이지당</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger size="sm" aria-label="페이지당 항목 수">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([...PAGE_SIZES, pageSize])]
                    .sort((a, b) => a - b)
                    .map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                ‹ 이전
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setPage(currentPage + 1)}
              >
                다음 ›
              </Button>
              <span className="tabular-nums text-muted-foreground">
                {currentPage} / {totalPages}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

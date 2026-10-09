"use client";

import { useTheme } from "next-themes";
import { DropdownMenuItem, DropdownMenuLabel } from "./dropdown-menu";

const THEMES = [
  { value: "system", label: "시스템" },
  { value: "light", label: "라이트" },
  { value: "dark", label: "다크" },
] as const;

/** 화면 모드(시스템/라이트/다크) 선택 항목. `DropdownMenuContent` 안에 넣어 쓴다. */
export function ThemeMenuItems() {
  const { theme = "system", setTheme } = useTheme();
  return (
    <>
      <DropdownMenuLabel>화면 모드</DropdownMenuLabel>
      {THEMES.map((t) => (
        <DropdownMenuItem
          key={t.value}
          role="menuitemradio"
          aria-checked={theme === t.value}
          onSelect={(e) => {
            e.preventDefault();
            setTheme(t.value);
          }}
          className={theme === t.value ? "font-medium" : undefined}
        >
          {t.label}
          {theme === t.value ? <span className="sr-only"> (선택됨)</span> : null}
        </DropdownMenuItem>
      ))}
    </>
  );
}

---
title: UI 재설계 — ERPNext(frappe-ui) 레퍼런스 분석과 공용 디자인 시스템 스펙
date: 2026-10-09
status: accepted
tags: [ui, design-system, tailwind, shadcn, layout, tokens, a11y]
related: [docs/rules/frontend.md, docs/rules/architecture.md, docs/rules/docs.md, PRD NFR-U02, PRD NFR-U03]
---

## 0. 이 문서의 위치

하위 구현 작업 3개가 이 문서만 보고 만든다. 형제 카드는 서로 볼 수 없으므로, 공유되는 결정(색상 값, 파일 이름, props)은 모두 여기에 적었다. 이 문서와 어긋나는 선택이 필요하면 구현하지 말고 작업을 막고(block) 문서 수정을 요청한다.

| 하위 작업 | 카드 | 브랜치 | 근거 절 |
|---|---|---|---|
| 색상·타이포 토큰 | t_a274fdec | wt/ui-t2-color-tokens | 3장, 4장, 5장 |
| 레이아웃 셸 | t_e1b50835 | wt/ui-t3-layout-shell | 6장, 7장 |
| 데이터 테이블 | t_974977ee | wt/ui-t4-data-table | 8장, 9장 |

레퍼런스는 코드를 옮기지 않고 **아이디어(토큰 위계, 구조, 밀도)** 만 가져온다. ERPNext 코드·Vue 컴포넌트를 복사하지 않는다.

## 1. 현황 (조사 결과)

- `apps/web/components.json`: style `radix-nova`, base **radix**(`radix-ui` 패키지), `cssVariables: true`, baseColor `neutral`, 아이콘 `lucide`, 별칭 `ui → @fmerp/shared/ui`. `rtl: false`.
- 설치된 UI(`shared/src/ui/*.tsx`, 18개): alert, badge, business-form, button, card, confirm-dialog, dropdown-menu, input, label, modal, pin-dialog, select, separator, sonner, table, tabs, textarea, use-reauth. **이미 있는 것은 다시 만들지 않는다.** `shared/package.json`의 exports가 `./ui/* → ./src/ui/*.tsx`이므로 **새 컴포넌트는 `shared/src/ui/` 바로 아래 평면 파일 하나당 컴포넌트 묶음 하나**로 둔다(하위 폴더 금지, 폴더를 만들면 import 경로가 풀리지 않는다).
- 색상: `apps/web/app/globals.css`가 shadcn 기본(무채색 oklch)이다. `@custom-variant dark (&:is(.dark *))` — 다크 모드는 **`.dark` 클래스 방식**이다. `shared/src/ui/sonner.tsx`가 `next-themes`의 `useTheme`을 쓰지만 `apps/web/app/providers.tsx`에 `ThemeProvider`가 없다 → 지금은 다크 모드를 켤 수단이 없다(5장에서 해결).
- 폰트: `next/font/google`의 Geist(`--font-sans`), `html lang="ko"`. 한글 글꼴 지정이 없다(4장).
- 셸: `apps/web/components/app-shell.tsx`(합성 루트, 여러 기능을 import)가 상단바(`max-w-5xl`) + 가로 스크롤 탭 내비게이션 + 본문 구조다. 사이드바·브레드크럼·페이지 헤더 없음. 각 페이지가 자기 `<h1>`과 버튼 배치를 제각각 만든다.
- 목록: `features/{approval,audit,backup,org,account}/src/ui/**`가 shadcn `Table`을 직접 조합한다(`document-table.tsx`, `admin-members.tsx`, `audit-logs.tsx`, `admin-backups.tsx` 등). 정렬·필터·일괄 작업·페이지네이션은 각자 구현 또는 없음. `@tanstack/react-table`은 **저장소 어디에도 설치되어 있지 않다**(`docs/rules/frontend.md`는 tablecn(TanStack Table 9)을 지정). 9.1장 참조.
- 상태 표시: `Badge`가 `default/secondary/destructive/outline/ghost/link`만 갖고, 결재 상태는 `d.status === "COMPLETED" ? "secondary" : "outline"` 식으로 제각각 분기한다. 상태 라벨은 `shared/src/lib/types.ts`의 `DOC_STATUS_LABEL`(8종)·`STEP_STATUS_LABEL`(9종)이 갖고 있다.

## 2. ERPNext(frappe-ui)에서 추출한 패턴 요약

출처: github.com/frappe/frappe-ui — `tailwind/tokens/*.js`, `tailwind/plugin.js`, `src/components/{Sidebar,Badge,Breadcrumbs,PageHeader,...}`. (demo.erpnext.com 화면은 이 환경에서 열어 보지 못했다. 아래는 frappe-ui 소스 기준이다.)

### 2.1 색상
- **무채색 + 채도 있는 상태색 6종**(gray·red·blue·green·amber·violet 외 yellow/orange/teal/cyan/purple/pink)으로 이루어진 **1~10단 의미 스케일**. 이름이 "색"이 아니라 **용도**다: `surface-*`(배경), `ink-*`(글자), `outline-*`(테두리). 번호가 클수록 진하다(글자 기준).
- 브랜드색이 따로 없다: 주 버튼은 **거의 검정(gray-10)** 이고, 파랑은 "정보/선택" 의미로만 쓴다. 화면 전체가 무채색이라 상태색이 눈에 띈다.
- **라이트/다크는 같은 의미 이름을 다른 값으로 바꾼다.** 다크에서는 같은 번호를 쓰되 스케일이 반전된다(surface-base = 거의 검정 `gray-950`, ink-gray-8 = 밝은 회색). 컴포넌트는 `dark:` 분기를 거의 쓰지 않는다.
- 상태 배지는 항상 같은 조합: **연한 배경(surface-X-2) + 진한 글자(ink-X-8) [+ 연한 테두리(outline-X-3)]**. 채움(solid)은 surface-X-7 + ink-X-1.
- 사이드바는 본문보다 한 단 어두운 면(`surface-sidebar` = gray-50), 다크에서는 본문과 같은 `gray-900`.
- 포커스: 박스 그림자가 아니라 `outline: 2px solid <연한 회색/상태색>` (`:focus-visible` 전역).
- 그림자(elevation)는 6단(sm~2xl)이고 테두리 1px 겹침 + 부드러운 확산을 합친 형태 — 카드는 그림자보다 **1px 테두리**를 주로 쓴다.

### 2.2 타이포·밀도
- 본문 기준 **14px**(base), 표·메타 13px/12px, 라인하이트 1.35, 글자 간격 +0.02em. 기본 두께 420(Inter 가변). 제목도 크지 않다(페이지 제목 ~18~20px semibold).
- 컨트롤 높이가 작다(입력 28px = h-7, 배지 20px = h-5). 모서리 반경은 5~8px, 배지는 pill.
- 결과: **정보 밀도가 높은 업무용 화면**. 4mERP도 데스크톱 업무 화면은 이 밀도로 가되, 모바일(360px) 결재는 터치 대상 ≥ 44px를 유지한다(7.4장).

### 2.3 레이아웃
- 데스크톱: **좌측 사이드바(고정, 접기 가능, 펼침 ≈ 240px·접힘 ≈ 48px) + 우측 본문**. 사이드바 = 헤더(조직/사용자 전환) · 섹션(라벨 + 항목 목록) · 하단 카드/계정.
- 모바일: 사이드바가 접힘(`smaller('sm')`) 또는 `BottomSheet`/`MobileNav`로 대체.
- 본문 상단 **PageHeader**: 왼쪽 = 브레드크럼 또는 제목, 오른쪽 = 액션 버튼 묶음(주 액션 1개를 가장 오른쪽). 구분선 1px 아래에 필터 바 → 목록.
- 목록 화면(ListView): 헤더 행(고정) + 행(구분선만, 줌 hover) + 체크박스 열 + 선택 시 **하단/상단에 일괄 작업 바**, 하단에 페이지 크기·페이지 이동. 빈 목록은 중앙 정렬 문구 + 주 액션.
- 폼 화면: 섹션(제목 + 구분선) 안에 **2열 그리드**(모바일 1열), 라벨은 필드 위 12~13px `ink-gray-5`, 필수 표시, 오류 문구는 필드 아래 빨강 12px.
- 다이얼로그/사이드시트: 중앙 모달은 짧은 확인·단일 폼, 긴 작업은 우측 시트(모바일은 하단 시트).

## 3. 번역 원칙

1. **semantic 토큰 이름은 기존 shadcn 이름을 유지한다**(`background`, `foreground`, `muted`, `primary`, `destructive`, `border`, `sidebar` …). frappe-ui의 `surface/ink/outline` 이름은 만들지 않는다. 값만 frappe-ui 스케일에서 가져온다.
2. **상태색은 shadcn에 없는 4종(success, warning, info, accent)을 추가**한다(destructive는 기존). 각각 `-bg / -fg / -bd`(+ solid 필요 시 `-solid`) 4변수를 둔다. 컴포넌트는 `bg-success-bg text-success-fg border-success-bd`처럼 **semantic 클래스만** 쓴다. `bg-green-100` 같은 raw 색 금지.
3. 라이트/다크는 변수 값만 바꾼다. 컴포넌트에 `dark:` 색 분기를 쓰지 않는다(기존 shadcn 컴포넌트에 이미 있는 `dark:` 분기는 건드리지 않는다).
4. 다크 모드 클래스는 기존 그대로 `.dark`. `next-themes`의 `ThemeProvider attribute="class"`로 켠다.
5. 숫자는 oklch 원본과 sRGB hex를 함께 적는다. **구현은 oklch 값을 CSS에 쓴다**(hex는 검증·디자인 대조용). 원본은 frappe-ui `tailwind/tokens/colors.js`의 light/dark 램프다.

## 4. 타이포그래피·모서리·그림자 결정 (카드 t2)

| 항목 | 결정 |
|---|---|
| 본문 글꼴 | 기존 Geist(`--font-sans`) 유지 + 한글 대비 폴백. `globals.css`의 `@theme inline`에 `--font-sans: var(--font-sans), "Pretendard Variable", Pretendard, "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif;`를 둔다. **새 웹폰트 패키지는 추가하지 않는다**(`dependencies.md`: 사용자 승인 필요). 한글은 시스템 폴백으로 렌더된다. |
| 기본 글자 크기 | `html { font-size: 16px }` 유지. 업무 화면 본문은 `text-sm`(14px), 표 셀 `text-sm`, 메타·라벨 `text-xs`(12px). 페이지 제목 `text-xl font-semibold`(20px), 섹션 제목 `text-base font-semibold`(16px). **새 `text-*` 커스텀 클래스를 만들지 않는다**(Tailwind 기본 스케일 사용). |
| 두께 | 본문 400, 강조 500, 제목 600. |
| 반경 | 기존 `--radius: 0.625rem`(10px) 유지. 카드/입력 `rounded-lg`, 배지 pill(`rounded-4xl`, 기존). 변경 없음. |
| 그림자 | 카드·표는 그림자 없이 `border`. 팝오버·모달만 기존 shadcn 그림자 유지. 새 elevation 토큰을 만들지 않는다. |
| 포커스 | 기존 shadcn `focus-visible:ring-3 ring-ring/50` 유지(WCAG 2.1 AA 대비 충족). `--ring` 값만 아래 색상표로 바꾼다. |

## 5. 색상 시스템 스펙 (카드 t2) — 확정 값

대상 파일: `apps/web/app/globals.css` (그 외 파일에 색 정의를 두지 않는다). 첫 열은 CSS 변수 이름(`--` 접두), "라이트/다크" 열은 **oklch(CSS에 그대로 씀) → hex(검증용)**.

### 5.1 기존 shadcn 변수 — 값 교체

| 변수 | 라이트 | 다크 |
|---|---|---|
| background | oklch(1 0 0) `#ffffff` | oklch(0.168 0 0) `#0f0f0f` |
| foreground | oklch(0.168 0 0) `#0f0f0f` | oklch(0.979 0 0) `#f8f8f8` |
| card / popover | oklch(1 0 0) `#ffffff` | oklch(0.205 0 0) `#171717` |
| card-foreground / popover-foreground | = foreground | = foreground |
| primary | oklch(0.205 0 0) `#171717` | oklch(0.979 0 0) `#f8f8f8` |
| primary-foreground | oklch(0.979 0 0) `#f8f8f8` | oklch(0.205 0 0) `#171717` |
| secondary / muted | oklch(0.964 0 0) `#f3f3f3` | oklch(0.281 0 0) `#292929` |
| secondary-foreground | oklch(0.205 0 0) `#171717` | oklch(0.979 0 0) `#f8f8f8` |
| muted-foreground | oklch(0.5 0 0) `#636363` | oklch(0.754 0 0) `#afafaf` |
| accent | oklch(0.946 0 0) `#ededed` | oklch(0.341 0 0) `#383838` |
| accent-foreground | oklch(0.205 0 0) `#171717` | oklch(0.979 0 0) `#f8f8f8` |
| destructive | oklch(0.556 0.198 26.552) `#ce2c2c` | oklch(0.639 0.196 24.565) `#eb4c4c` |
| border | oklch(0.913 0 0) `#e2e2e2` | oklch(0.341 0 0) `#383838` |
| input | oklch(0.913 0 0) `#e2e2e2` | oklch(0.379 0 0) `#424242` |
| ring | oklch(0.683 0 0) `#999999` | oklch(0.58 0 0) `#7a7a7a` |
| sidebar | oklch(0.979 0 0) `#f8f8f8` | oklch(0.205 0 0) `#171717` |
| sidebar-foreground | = foreground | = foreground |
| sidebar-primary / sidebar-primary-foreground | = primary / primary-foreground | = primary / primary-foreground |
| sidebar-accent | oklch(0.946 0 0) `#ededed` | oklch(0.281 0 0) `#292929` |
| sidebar-accent-foreground | oklch(0.205 0 0) `#171717` | oklch(0.979 0 0) `#f8f8f8` |
| sidebar-border | oklch(0.913 0 0) `#e2e2e2` | oklch(0.281 0 0) `#292929` |
| sidebar-ring | = ring | = ring |
| chart-1~5, radius | **변경 없음** | **변경 없음** |

참고: frappe-ui의 `ink-gray-4`(라이트 oklch 0.683, `#999999`)는 흰 배경에서 AA(4.5:1)에 미달하므로 `muted-foreground`는 **0.5**로 어둡게 보정했다(아래 5.4 대비표). 이 값을 임의로 되돌리지 않는다. 다크의 `border`는 기존의 `oklch(1 0 0 / 10%)` 대신 불투명 값을 쓴다.

### 5.2 신규 상태색 변수 (라이트 | 다크)

| 변수 | 라이트 | 다크 |
|---|---|---|
| success-bg | oklch(0.965 0.03 155.987) `#e4faeb` | oklch(0.295 0.057 157.43) `#0e3521` |
| success-fg | oklch(0.425 0.101 155.32) `#085e35` | oklch(0.866 0.091 162.299) `#9be6c1` |
| success-bd | oklch(0.872 0.084 155.952) `#a8e6be` | oklch(0.41 0.095 156.411) `#085934` |
| success-solid | oklch(0.57 0.119 158.092) `#258c5c` | oklch(0.607 0.116 158.84) `#369768` |
| warning-bg | oklch(0.967 0.045 91.733) `#fff4d3` | oklch(0.303 0.062 60.12) `#452608` |
| warning-fg | oklch(0.472 0.124 46.689) `#91400d` | oklch(0.84 0.13 82.404) `#f4c25f` |
| warning-bd | oklch(0.917 0.063 91.484) `#f3e3b4` | oklch(0.417 0.1 53.718) `#753a08` |
| warning-solid | oklch(0.659 0.142 67.548) `#ca7e0e` | oklch(0.763 0.137 69.783) `#e9a143` |
| danger-bg | oklch(0.947 0.026 17.626) `#ffe7e7` | oklch(0.333 0.082 22.544) `#592222` |
| danger-fg | oklch(0.438 0.153 26.273) `#941f1f` | oklch(0.867 0.071 18.63) `#ffc1c1` |
| danger-bd | oklch(0.867 0.068 18.55) `#fdc2c2` | oklch(0.422 0.126 24.306) `#852929` |
| info-bg | oklch(0.96 0.021 241.348) `#e6f4ff` | oklch(0.305 0.092 256.675) `#0a2e5c` |
| info-fg | oklch(0.477 0.149 253.403) `#005cad` | oklch(0.849 0.063 247.116) `#add2f5` |
| info-bd | oklch(0.88 0.061 242.553) `#b5ddfd` | oklch(0.397 0.117 252.902) `#074783` |
| info-solid | oklch(0.587 0.174 252.167) `#077ddf` | oklch(0.671 0.155 247.709) `#349bef` |
| accent2-bg | oklch(0.943 0.031 297.722) `#eee8ff` | oklch(0.318 0.121 284.702) `#2f236c` |
| accent2-fg | oklch(0.356 0.139 285.299) `#392980` | oklch(0.8 0.107 294.723) `#c2b0fc` |
| accent2-bd | oklch(0.852 0.077 295.563) `#d2c5fc` | oklch(0.401 0.144 283.801) `#423691` |

- `danger-*`는 "위험/반려"의 **연한 면** 용도다. 기존 `destructive`(진한 빨강, 삭제 버튼·오류 글자)와 역할이 다르므로 둘 다 둔다. `danger-solid`는 만들지 않는다(`destructive`가 그 역할).
- 이름 `accent2`는 shadcn의 `accent`(호버 면)와 충돌을 피하려는 이름이다. 의미는 "보라: 위임/특수 상태"다.
- `*-solid`는 채움형(점·진행바·아이콘) 전용이다. **흰 글자를 올리지 않는다**(대비 3.2~4.2:1로 AA 미달). 글자는 `-fg`만 쓴다.

### 5.3 `@theme inline`에 추가할 매핑

기존 `--color-*` 줄 뒤에, 5.2의 모든 변수에 대해 `--color-<이름>: var(--<이름>);`를 추가한다. 예: `--color-success-bg: var(--success-bg);` → 사용 클래스 `bg-success-bg`, `text-success-fg`, `border-success-bd`, `bg-success-solid`. 총 18개(success·warning·info 각 4, danger 3, accent2 3) 전부.

### 5.4 대비 검증값 (WCAG AA 4.5:1, 계산 완료)

| 조합 | 라이트 | 다크 |
|---|---|---|
| foreground / background | 19.2 | 18.1 |
| muted-foreground / background | 6.0 | 8.7 |
| muted-foreground / muted | 5.4 | 6.6 |
| muted-foreground / sidebar | 5.7 | 8.2 |
| primary-foreground / primary | 16.9 | 16.9 |
| success-fg / success-bg | 7.2 | 9.3 |
| warning-fg / warning-bg | 6.5 | 8.3 |
| danger-fg / danger-bg | 7.2 | 8.1 |
| info-fg / info-bg | 6.0 | 8.5 |
| accent2-fg / accent2-bg | 9.8 | 6.9 |

구현 작업은 변경 후 위 표의 조합이 실제 화면에서 이 값을 유지하는지(값을 틀리게 옮기지 않았는지) 확인한다.

### 5.5 다크 모드 활성화

- `apps/web/app/providers.tsx`에 `next-themes`의 `ThemeProvider`(`attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`)를 `QueryClientProvider` 바깥에 추가한다. `next-themes`는 `shared/package.json`에만 있다(`~0.4.6`). `apps/web/package.json`에 **추가해야 import가 풀리는지** 먼저 확인하고, 필요하면 같은 버전 범위로 추가한다(기존 선언된 의존성이라 새 패키지 도입이 아님을 PR에 적는다).
- `apps/web/app/layout.tsx`의 `<html>`에 `suppressHydrationWarning`을 추가한다.
- 테마 전환 UI: 사용자 메뉴(7.2장 `UserMenu`)에 "화면 모드: 시스템/라이트/다크" 3항목을 둔다(`DropdownMenuRadioGroup`이 없으면 `DropdownMenuItem` 3개로 대체). 전환 컴포넌트는 `shared/src/ui/theme-toggle.tsx`의 `ThemeMenuItems`다(7.5장).

### 5.6 `Badge`에 노출할 variant

`shared/src/ui/badge.tsx`의 `badgeVariants.variant`에 아래 5개를 **추가**한다(기존 6개 변경 금지):

| variant | 클래스 |
|---|---|
| success | `border-success-bd bg-success-bg text-success-fg` |
| warning | `border-warning-bd bg-warning-bg text-warning-fg` |
| danger | `border-danger-bd bg-danger-bg text-danger-fg` |
| info | `border-info-bd bg-info-bg text-info-fg` |
| accent | `border-accent2-bd bg-accent2-bg text-accent2-fg` |

(기존 `Badge`의 `border border-transparent` 위에서 `border-*-bd`가 덮어쓰도록 클래스 순서를 variant 문자열 끝에 둔다.) 이 파일을 고치는 것이 `frontend.md` 1장 "기본 컴포넌트를 크게 고치지 말고"에 어긋나지 않는 이유: variant 문자열 추가뿐이고 구조는 그대로다. 같은 방식으로 `Alert`에는 `success / warning / info` variant를 **추가하지 않는다**(이번 범위 밖, 필요하면 후속).

### 5.7 상태 → 배지 매핑 (`StatusBadge`, 신규 `shared/src/ui/status-badge.tsx`)

`StatusBadge`는 `Badge`를 감싸는 컴포넌트다. 매핑 표는 이 파일이 소유한다(feature가 variant를 직접 고르지 않게 한다).

```ts
type StatusTone = "success" | "warning" | "danger" | "info" | "accent" | "neutral" | "muted";
// props: { kind: "document" | "step"; status: string; className?: string }
// 라벨은 DOC_STATUS_LABEL / STEP_STATUS_LABEL (shared/src/lib/types.ts) 에서 찾고, 없으면 status 원문.
```

| kind | status | tone → Badge variant |
|---|---|---|
| document | DRAFT 임시저장 | neutral → `outline` |
| document | IN_PROGRESS 진행 중 | info → `info` |
| document | ON_HOLD 보류 | warning → `warning` |
| document | WITHDRAWN 회수 | muted → `secondary` |
| document | REJECTED 반려 | danger → `danger` |
| document | COMPLETED 완료 | success → `success` |
| document | CANCELED 취소 | muted → `secondary` |
| document | ARCHIVED 보관 | neutral → `outline` |
| step | PENDING 대기 | muted → `secondary` |
| step | ACTIVE 결재 차례 | info → `info` |
| step | APPROVED 승인 | success → `success` |
| step | REJECTED 반려 | danger → `danger` |
| step | HELD 보류 | warning → `warning` |
| step | SKIPPED 건너뜀 | neutral → `outline` |
| step | DELEGATED 대결 처리 | accent → `accent` |
| step | POST_PENDING 후결 대기 | warning → `warning` |
| step | POST_APPROVED 후결 완료 | success → `success` |
| (알 수 없는 값) | * | neutral → `outline` |

색만으로 구분하지 않는다(KWCAG): 라벨 텍스트가 항상 보인다. 아이콘은 붙이지 않는다(범위 최소화). 단위 시험: 17개 매핑과 "알 수 없는 값" 폴백을 `status-badge.test.ts`(Vitest, 매핑 함수 `statusTone(kind, status)`를 export해 테스트)로 검증한다. 순수 함수는 `.tsx`가 아니라 같은 파일에서 export해도 된다.

## 6. 레이아웃 시스템 스펙 (카드 t3)

### 6.1 구조 결정

- 데스크톱(≥ 1024px, `lg`): **좌측 사이드바 + 상단 얇은 바 없음 + 본문**. 사이드바 폭 펼침 `w-60`(240px), 접힘 `w-14`(56px, 아이콘만). 접힘 상태는 `localStorage` 키 `fmerp.sidebar.collapsed`("1"/"0")에 저장한다. 서버 렌더와 맞추기 위해 초기 렌더는 펼침, 마운트 후 반영한다.
- 태블릿·모바일(< 1024px): 사이드바는 숨기고, **상단 바(h-14)에 메뉴 버튼 + 로고 + 알림 + 사용자 메뉴**. 메뉴 버튼은 사이드바 내용을 **왼쪽 드로어**로 연다(드로어는 `Modal`이 아니라 `radix-ui`의 `Dialog`를 쓰는 새 `shared/src/ui/sheet.tsx`로 만든다. shadcn CLI가 이 저장소에서 실행되지 않으므로 직접 작성해도 된다 — `modal.tsx` 주석 참조. 사용 라이브러리는 이미 설치된 `radix-ui`).
- 데스크톱에서도 본문 위에 얇은 상단 바(h-12)를 둔다: 왼쪽 = 접기 버튼, 오른쪽 = 알림·사용자 메뉴. **브레드크럼과 페이지 제목은 상단 바가 아니라 본문 안 `PageHeader`가 맡는다.**
- 본문 최대 폭: 목록·대시보드 `max-w-screen-2xl`(없으면 제한 없음), **폼·상세 `max-w-4xl`**. 본문 여백 `p-4`(모바일) → `sm:p-6` → `lg:px-8`.
- 모든 페이지 컨테이너 최소 폭 360px에서 가로 스크롤이 생기지 않아야 한다(표는 자체 `overflow-x-auto` 내부에서만 스크롤).

### 6.2 사이드바 (색상·밀도)

- 배경 `bg-sidebar`, 오른쪽 `border-r border-sidebar-border`, 글자 `text-sidebar-foreground`.
- 항목: 높이 `h-9`(36px, 터치 영역 확보를 위해 모바일 드로어에서는 `h-11`=44px), `rounded-md px-2.5 gap-2.5 text-sm`, 아이콘 `size-4`(lucide). 활성 = `bg-sidebar-accent text-sidebar-accent-foreground font-medium` + `aria-current="page"`. 호버 `hover:bg-sidebar-accent/60`.
- 섹션: 라벨 `px-2.5 pb-1 pt-4 text-xs font-medium text-muted-foreground`(접힘 시 숨기고 구분선 `Separator`로 대체).
- 배지(건수): 우측 정렬 `ml-auto`, `Badge variant="secondary"`(결재 대기 건수는 `variant="info"`), 스크린리더용 "건" 문구 유지(기존 `app-shell.tsx`의 `sr-only` 패턴).
- 접힘 상태의 항목은 `title`(+ `aria-label`)로 이름을 노출하고, 호버 툴팁은 만들지 않는다(툴팁 컴포넌트 미설치).
- 내비게이션 항목은 **타입 `NavSection[]`으로 주입**한다(feature를 import하지 않는다).

### 6.3 페이지 헤더 (모든 페이지 공통)

- 구조: 한 줄 `flex flex-wrap items-center justify-between gap-3 pb-4`, 그 아래 `border-b`(옵션).
  - 왼쪽: (옵션) 브레드크럼 `text-xs text-muted-foreground`, 그 아래 제목 `<h1 class="text-xl font-semibold">`, (옵션) 설명 `text-sm text-muted-foreground`.
  - 오른쪽: 액션 묶음 `flex items-center gap-2`. **주 액션(`Button` default) 1개만 가장 오른쪽**, 보조는 `outline`/`ghost`. 모바일(< sm)에서는 헤더가 줄바꿈되어 액션이 제목 아래 전체 폭 줄로 내려간다.
- `<h1>`은 페이지에 하나. 기존 페이지의 자체 `<h1>`은 구현 작업이 `PageHeader`로 교체하는 **대상 1개 페이지**에서만 바꾼다(전 페이지 일괄 교체는 후속 작업).

### 6.4 목록 화면 표준 배치

```
PageHeader (제목 / 액션)
FilterBar  (검색 입력 + 필터 Select들 + 우측 보조 버튼)   ← 8.3장
DataTable  (헤더 행 · 본문 행 · 일괄 작업 바)               ← 8장
Pagination (왼쪽: "총 N건", 오른쪽: 페이지 크기 · 이전/다음)
```
세로 간격: 섹션 사이 `gap-4`. 표는 `rounded-lg border`(그림자 없음).

### 6.5 폼·상세 화면 표준 배치

- 최상위 `max-w-4xl`, 섹션은 `Card`(`CardHeader`: 제목 + 설명, `CardContent`: 필드 그리드). 섹션 사이 `gap-6`.
- 필드 그리드: `grid grid-cols-1 gap-4 sm:grid-cols-2`. 긴 필드(주소·설명·textarea)는 `sm:col-span-2`. 라벨은 필드 위(`Label`, 12~13px `text-sm font-medium`), 필수 표시는 라벨 뒤 ` *`(`aria-hidden`) + 입력 `required`. 오류 문구는 필드 아래 `text-xs text-destructive`, 입력에는 `aria-invalid`.
- 하단 액션 바: 폼 맨 아래 `flex justify-end gap-2 border-t pt-4`, 모바일에서는 `sticky bottom-0 bg-background`로 고정(결재 버튼이 가려지지 않게 `pb-[env(safe-area-inset-bottom)]`).
- **폼 필드 래퍼 `FormField`**(신규 `shared/src/ui/form-field.tsx`)를 만들지는 **않는다**: shadcn `Field` 계열이 설치돼 있지 않고, 기존 폼(`business-form.tsx`)이 `Label + Input`을 직접 쓴다. 이번 범위에서는 위 배치 규칙을 문서로만 고정하고 컴포넌트화는 후속(idea)이다.

### 6.6 빈 상태

신규 `shared/src/ui/empty-state.tsx`의 `EmptyState`: 중앙 정렬 `flex flex-col items-center gap-2 py-12 text-center`, 아이콘(옵션, `size-8 text-muted-foreground`), 제목 `text-sm font-medium`, 설명 `text-sm text-muted-foreground`, 액션(옵션). props는 7.5장.

## 7. 공용 컴포넌트 스펙 — 셸 (카드 t3)

모두 `shared/src/ui/<파일>.tsx`. 경로 별칭은 `@fmerp/shared/ui/<파일>`. 이미 있는 `Button`·`Badge`·`DropdownMenu*`·`Separator`·`Card*`·`cn`(`@fmerp/shared/lib/utils`, shared 내부에서는 `cn` 패키지 import는 기존 파일 관례를 따른다 — 기존 파일은 `import { cn } from "cn"`)을 재사용한다. 모든 컴포넌트는 `"use client"`가 필요한 것만 선언한다.

### 7.1 `app-frame.tsx` — `AppFrame`

```ts
export type NavItem = {
  href: string;
  label: string;               // 한국어
  icon?: LucideIcon;           // lucide-react 컴포넌트 (문자열 키 금지)
  count?: number;              // 0/undefined면 숨김
  countLabelSuffix?: string;   // sr-only 접미사, 기본 "건"
  tone?: "default" | "info";   // 건수 배지 색, 기본 default(secondary)
  match?: "prefix" | "exact";  // 활성 판정, 기본 prefix
};
export type NavSection = { id: string; label?: string; items: NavItem[] };
export type AppFrameProps = {
  brand: ReactNode;            // 사이드바/상단 바 로고 영역 (링크 포함해서 넘긴다)
  nav: NavSection[];           // 합성 루트가 주입
  pathname: string;            // 활성 판정용. usePathname() 결과를 합성 루트가 넘긴다
  switcher?: ReactNode;        // 사이드바 상단의 회사 전환 등
  topbarEnd?: ReactNode;       // 상단 바 오른쪽 (알림, 사용자 메뉴)
  children: ReactNode;         // 본문
};
export function AppFrame(props: AppFrameProps): JSX.Element;
```

- `next/link`·`next/navigation`을 import하지 않는다(`shared/src/ui`는 프레임워크 중립). 링크 렌더는 `renderLink?: (props: { href: string; className: string; "aria-current"?: "page"; title?: string; children: ReactNode }) => ReactNode` prop(기본값: `<a>`)으로 합성 루트가 `next/link`를 끼운다. **이 prop은 `AppFrameProps`에 포함한다.**
- 레이아웃: `lg` 이상 `grid lg:grid-cols-[auto_1fr]`, 사이드바 `sticky top-0 h-dvh`. `lg` 미만은 상단 바 + 왼쪽 드로어(6.1장).
- 본문 `<main id="main">` 앞에 스킵 링크 "본문으로 건너뛰기"(`sr-only focus:not-sr-only`). 사이드바 `<nav aria-label="주 메뉴">`.
- 접기 토글 버튼: `aria-label="사이드바 접기"/"사이드바 펼치기"`, `aria-expanded`.

### 7.2 `user-menu.tsx` — `UserMenu` (옵션, 있으면 좋음)

기존 `apps/web/components/app-shell.tsx`의 사용자 드롭다운을 기능 중립으로 옮긴 것이다. 필요하면 만들고, 만들지 않으면 `topbarEnd`에 합성 루트가 `DropdownMenu`를 그대로 꽂는다. **이번 카드의 필수 산출물이 아니다**(필수는 7.1, 7.3~7.5).

### 7.3 `page-header.tsx` — `PageHeader`

```ts
export type PageHeaderProps = {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];   // 7.4
  actions?: ReactNode;              // 오른쪽 액션 묶음
  className?: string;
};
export function PageHeader(props: PageHeaderProps): JSX.Element;
```
구조·간격은 6.3장. `title`은 `<h1>`.

### 7.4 `breadcrumb.tsx` — `Breadcrumb`

```ts
export type BreadcrumbItem = { label: string; href?: string };   // 마지막 항목은 href 없이 현재 페이지
export function Breadcrumb(props: {
  items: BreadcrumbItem[];
  renderLink?: (p: { href: string; className: string; children: ReactNode }) => ReactNode;
  className?: string;
}): JSX.Element;
```
`<nav aria-label="현재 위치"><ol>` 구조, 구분자 `ChevronRight`(`aria-hidden`), 마지막 항목 `aria-current="page"`. 모바일에서는 항목이 3개를 넘으면 가운데를 `…`로 줄이고 마지막 두 개만 보인다(CSS `hidden sm:inline`로 처리 가능한 선에서).
모바일 터치: 링크 영역에 `py-2` 이상.

### 7.5 기타 신규 컴포넌트

| 파일 | export | props | 설명 |
|---|---|---|---|
| `empty-state.tsx` | `EmptyState` | `{ icon?: LucideIcon; title: string; description?: string; action?: ReactNode; className?: string }` | 6.6장 |
| `sheet.tsx` | `Sheet`, `SheetContent`, `SheetTitle`, `SheetDescription`, `SheetTrigger`, `SheetClose` | shadcn Sheet(radix Dialog 기반) 표준 API. `SheetContent`는 `side?: "left"\|"right"\|"bottom"`(기본 right) | 모바일 내비 드로어·상세 사이드시트. **`SheetTitle` 필수**(스크린리더용, 숨길 때 `sr-only`) |
| `theme-toggle.tsx` | `ThemeMenuItems` | 없음 | `useTheme()`로 시스템/라이트/다크 `DropdownMenuItem` 3개. `DropdownMenuContent` 안에 넣어 쓴다 |
| `status-badge.tsx` | `StatusBadge`, `statusTone` | 5.7장 | |
| `stat-card.tsx` | `StatCard` | `{ label: string; value: ReactNode; hint?: string; tone?: "default"\|"success"\|"warning"\|"danger"\|"info"; href?: string; icon?: LucideIcon }` | 통계 위젯. `Card` 기반, 값 `text-2xl font-semibold tabular-nums`, `tone`은 좌측 4px 막대(`border-l-4`는 쓰지 않는다 — 아이콘 칩 배경 `bg-<tone>-bg text-<tone>-fg`만 쓴다). 홈 대시보드(`features/home`)가 후속으로 소비 |

`ModalContainerContext`(기존 `modal.tsx`)와 `Sheet`는 별개다: `Sheet` 안에 `Select`를 넣는 경우를 고려하지 않는다(범위 밖). 사이드시트에 폼 필드가 필요한 후속 작업은 그때 처리한다.

### 7.6 합성 루트 변경 (`apps/web`)

- `apps/web/components/app-shell.tsx`는 **합성 루트에 남는다**(여러 기능 import 허용 지점). 내부를 `AppFrame`으로 교체한다: 기존 `useMe/usePending/useUnreadCount/...` 훅 호출은 유지하고, 기존 상단 탭 6개 + 회사 전환 + 알림 + 사용자 메뉴 항목을 `nav`(섹션 3개: "전자결재" = 새 결재·결재 대기(건수)·기안함·문서함·검색, "조직" = 조직도, "관리"(권한이 있는 경우) = 관리 콘솔(`adminEntry(caps)` 링크)) / `switcher`(회사 전환 드롭다운) / `topbarEnd`(알림 + 사용자 메뉴, 사용자 메뉴에 `ThemeMenuItems` 추가)로 매핑한다.
- 아이콘(lucide): 새 결재 `FilePlus2`, 결재 대기 `Inbox`, 기안함 `Send`, 문서함 `Archive`, 검색 `Search`, 조직도 `Network`, 관리 콘솔 `Settings`. 기존 아이콘 import 일부(`Send`)는 사용자 메뉴에서 이미 쓰이므로 중복 선언만 정리한다.
- `renderLink`로 `next/link`를 연결한다.
- **적용 대상 페이지(필수 1개)**: `features/home/src/ui/pages/home.tsx`의 상단 제목 영역을 `PageHeader`로 교체한다. 다른 페이지의 마크업은 건드리지 않는다.
- 새 파일은 `tools/src/feature-assignment.ts`에 배정하고(`shared/src/ui/*`는 공통), 화면·API가 바뀌었으므로 해당 `feature.map.yaml`(home)을 확인·갱신한 뒤 `pnpm feature:index`를 실행한다. 새 컴포넌트가 사용처 없이 남으면 Knip이 미사용으로 막으므로, 이번 카드에서 쓰이지 않는 컴포넌트(`StatCard` 등)는 **만들지 않는다**(만든 것만 쓰이게 하거나, 필요 없으면 7.5의 표에서 제외한다). 적용 우선순위는 필수 = `AppFrame`·`PageHeader`·`Breadcrumb`·`Sheet`·`ThemeMenuItems`·`EmptyState`, 선택 = `UserMenu`·`StatCard`.

## 8. 데이터 테이블 스펙 (카드 t4)

### 8.1 파일·의존성

- 신규 `shared/src/ui/data-table.tsx`(헤드리스 로직 + 렌더) — 기존 `shared/src/ui/table.tsx`의 `Table, TableHeader, TableBody, TableRow, TableHead, TableCell`을 **감싸서** 쓴다. `table.tsx`는 수정하지 않는다.
- 이 저장소에는 `@tanstack/react-table`이 없다. `docs/rules/frontend.md`는 TanStack Table 9를 지정하므로, **구현 카드는 이 패키지 추가가 필요한지 먼저 판단한다**: 아래 8.2 기능(정렬·선택·페이지네이션·필터)은 **외부 라이브러리 없이 구현할 수 있는 분량**이다(클라이언트 사이드 100명 규모). 따라서 **결정: 라이브러리를 추가하지 않고 `data-table.tsx` 안에서 `useState`로 직접 구현한다.** 대량 데이터·가상 스크롤이 필요해지면 그때 `dependencies.md`에 따라 사용자 승인 후 `@tanstack/react-table`을 도입한다(후속 idea). 이 결정은 규칙 문서 위반이 아니라 "요청된 것만 만든다"(CLAUDE.md 작업 원칙 2)를 따른 것이다.
- 정렬·필터·페이지네이션은 **클라이언트 사이드**(전달된 `rows` 전체를 대상)가 기본. 서버 사이드는 `manual` prop으로 후속(이번 범위 밖).

### 8.2 API

```ts
export type DataTableColumn<T> = {
  id: string;                          // 고유 키
  header: string;                      // 한국어 헤더 문구
  cell: (row: T) => ReactNode;         // 셀 렌더
  sortValue?: (row: T) => string | number | null;   // 있으면 정렬 가능 열
  align?: "left" | "right";            // 숫자·금액 열은 right (tabular-nums 자동 적용)
  className?: string;                  // 열 폭 지정 등 (th/td 공통)
  hideBelow?: "sm" | "md";             // 이 너비 미만에서 열 숨김 (hidden + sm:table-cell)
};

export type DataTableProps<T> = {
  rows: T[];
  columns: DataTableColumn<T>[];
  rowKey: (row: T) => string;
  caption: string;                     // sr-only <caption>. 접근성 필수
  isLoading?: boolean;                 // true면 Skeleton 대신 "불러오는 중…" 행 5개 (Skeleton 컴포넌트 미설치)
  empty?: ReactNode;                   // 기본: <EmptyState title="표시할 항목이 없습니다" />
  search?: { placeholder: string; text: (row: T) => string };   // 있으면 FilterBar에 검색 입력 표시, 대소문자 무시 부분 일치
  filters?: DataTableFilter<T>[];      // 8.3
  selectable?: boolean;                // 체크박스 열 + 일괄 작업 바
  bulkActions?: (selected: T[], clear: () => void) => ReactNode;   // selectable일 때 선택 1건 이상이면 표시
  pageSize?: number;                   // 기본 20. 선택지 [10, 20, 50]
  onRowClick?: (row: T) => void;       // 행 전체 클릭(키보드: 첫 셀의 링크/버튼이 담당. 행 자체는 포커스 대상 아님)
  toolbarEnd?: ReactNode;              // FilterBar 오른쪽 보조 버튼 영역
  className?: string;
};

export type DataTableFilter<T> = {
  id: string;
  label: string;                       // Select의 접근성 이름
  allLabel: string;                    // 예: "전체 상태"
  options: { value: string; label: string }[];
  predicate: (row: T, value: string) => boolean;
};

export function DataTable<T>(props: DataTableProps<T>): JSX.Element;
```

### 8.3 동작·모양 (확정)

- **FilterBar**(표 위, `flex flex-wrap items-center gap-2 pb-3`): 검색 `Input`(`type="search"`, `aria-label`=placeholder, 폭 `w-full sm:w-64`), 필터마다 기존 `Select`(`@fmerp/shared/ui/select`), 오른쪽 `toolbarEnd`(`ml-auto`). 필터·검색이 바뀌면 1페이지로 돌아간다. "초기화" 링크 버튼은 필터가 하나라도 걸렸을 때만 표시.
- **헤더 행**: `bg-muted/50 text-xs font-medium text-muted-foreground`, 정렬 가능 열은 `<th aria-sort="ascending|descending|none">` 안에 `<button>`으로 헤더 문구 + 정렬 아이콘(lucide `ArrowUp`/`ArrowDown`/`ChevronsUpDown`, `size-3.5`). 클릭 순환: 없음 → 오름 → 내림 → 없음. `null`은 항상 끝.
- **본문 행**: `border-b` 구분선, `hover:bg-muted/50`, 선택된 행 `bg-muted`(`data-state="selected"`), 셀 `py-2.5 px-3 text-sm`. 행 높이 약 40px(데스크톱), 모바일에서는 `py-3`(터치 대상 확보).
- **선택**: 첫 열 `Checkbox`가 설치돼 있지 않으므로 `<input type="checkbox">`에 `accent-primary size-4`를 쓴다(새 `Checkbox` 컴포넌트는 범위 밖). 헤더 체크박스 = 현재 **필터 결과의 현재 페이지** 전체 선택/해제, `indeterminate` 반영(`ref`로 설정). 각 행 체크박스의 접근성 이름은 `selectLabel?: (row: T) => string` prop으로 받는다(기본 "행 선택"). **이 prop을 `DataTableProps`에 포함한다.** 선택은 `rowKey` 집합으로 보관하고, 필터/정렬/페이지가 바뀌어도 유지하되 **존재하지 않게 된 키는 제거**한다.
- **일괄 작업 바**: 선택 ≥ 1이면 표 **바로 위**(FilterBar와 같은 줄을 대체)에 `rounded-lg border bg-muted px-3 py-2 text-sm` 바: "N건 선택됨" + `bulkActions(selected, clear)` + "선택 해제" ghost 버튼. 바 영역에 `role="status"` `aria-live="polite"`.
- **페이지네이션**(표 아래, `flex flex-wrap items-center justify-between gap-2 pt-3 text-sm`): 왼쪽 "총 N건" (필터 후 건수), 오른쪽 "페이지당" `Select`(10/20/50) + "‹ 이전" "다음 ›"(`Button variant="outline" size="sm"`, 경계에서 `disabled`) + "p / 전체p". 건수가 pageSize 이하면 페이지 이동 컨트롤은 숨기고 "총 N건"만 표시.
- **로딩/빈 상태/오류**: 로딩은 헤더를 유지하고 본문에 `colSpan` 한 행 "불러오는 중…"(`aria-busy`). 빈 상태는 필터가 걸린 경우 "조건에 맞는 항목이 없습니다 + 필터 초기화 버튼", 걸리지 않은 경우 `empty` prop 또는 기본 문구. 오류 표시는 호출하는 페이지가 기존 `Alert`로 한다(DataTable은 오류 상태를 갖지 않는다).
- **모바일(< sm)**: 표는 `Table` 컨테이너의 `overflow-x-auto` 안에서 가로 스크롤. `hideBelow`가 지정된 열은 숨겨 첫 열 + 상태 열이 한 화면에 들어오도록 설계한다. 일괄 작업 바의 버튼은 줄바꿈 허용.
- 접근성: `<caption class="sr-only">`, 정렬 버튼에 `aria-label="<header> 정렬"`, 키보드로 전부 조작 가능, 색만으로 상태를 전달하지 않는다.

### 8.4 적용 대상 (필수 1곳)

`features/approval/src/ui/components/document-table.tsx`(문서함·기안함이 공유하는 표)를 `DataTable`로 교체한다. 열: 문서번호(정렬), 제목(링크, 검색 대상), 양식, 기안자(`hideBelow:"md"`), 상태(`StatusBadge kind="document"`, 필터 `전체 상태`), 상신일(정렬, `formatDateTime`, `hideBelow:"sm"`). `selectable`은 이번 적용에서 쓰지 않는다(일괄 작업 API 없음) — **기능은 구현하되 사용처는 없으므로**, Knip의 미사용 export 규칙에 걸리지 않는지 확인하고 걸리면 `selectable`/`bulkActions` 구현은 유지하되 사용처가 있는 곳에서만 검증한다(걸리는 경우 사용자에게 보고하고 막는다). 기존 `Table` 직접 사용 페이지(감사 로그·구성원 등)는 이번 카드에서 바꾸지 않는다(후속).

## 9. 구현 순서·충돌 방지

1. **t2(토큰)** 이 먼저 머지되어야 `StatusBadge`·`StatCard`가 쓰는 클래스가 의미를 가진다. t3·t4는 t2 없이도 작성은 가능하나, 화면 확인은 t2 머지 뒤에 한다.
2. 파일 소유: t2 = `apps/web/app/globals.css`, `apps/web/app/providers.tsx`, `apps/web/app/layout.tsx`, `shared/src/ui/badge.tsx`, `shared/src/ui/status-badge.tsx`(+ 시험), `shared/src/ui/theme-toggle.tsx`. t3 = `shared/src/ui/{app-frame,page-header,breadcrumb,empty-state,sheet}.tsx`, `apps/web/components/app-shell.tsx`, `features/home/src/ui/pages/home.tsx`(제목 영역만). t4 = `shared/src/ui/data-table.tsx`, `features/approval/src/ui/components/document-table.tsx`. **`ThemeMenuItems`는 t2가 만들고, t3가 사용자 메뉴에 꽂는다 → t3는 t2 머지 뒤에 `theme-toggle.tsx`가 없으면 이 항목만 생략한다.** `EmptyState`는 t3가 만들고 t4의 `DataTable` 기본 빈 상태가 쓴다 → **t4는 t3 머지 전이면 `empty-state.tsx`가 없으므로 DataTable 안에서 최소한의 인라인 빈 상태 마크업(`py-12 text-center text-sm text-muted-foreground`)을 쓰고, t3 머지 후 후속에서 교체한다.**
3. 핫스팟 주의: `apps/web/app/globals.css`는 t2만, `app-shell.tsx`는 t3만 수정한다.
4. 각 카드 공통 완료 검사: `pnpm typecheck`, `pnpm lint`, `pnpm arch:check`(새 소스 파일이 `tools/src/feature-assignment.ts`에 배정됐는지, Knip 미사용 없음), 변경과 관련된 단위 시험, 화면이 바뀐 카드는 `playwright-cli`로 라이트·다크(t2), 1280px·360px(t3), 문서함 표(t4) 확인.

## 10. 범위 밖 (후속 idea)

- 전 페이지의 `PageHeader`·`DataTable` 일괄 교체, 서버 사이드 정렬·페이지네이션, 가상 스크롤.
- `@tanstack/react-table` 도입, 컬럼 가시성·열 크기 조절, CSV 내보내기 버튼.
- `Field`/`FormField` 컴포넌트화, `Checkbox`·`Skeleton`·`Tooltip`·`Combobox` 컴포넌트 추가.
- 웹폰트(Pretendard) 도입 — 새 의존성 승인 필요.
- 홈 대시보드를 `StatCard`로 재구성.
- demo.erpnext.com 화면 캡처 대조(이 조사에서는 열어 보지 못했다).

## 11. 결정·변경 기록

- 2026-10-09: frappe-ui 토큰(`tailwind/tokens/colors.js` 외)을 읽어 oklch 값을 sRGB hex로 환산하고 WCAG 대비를 계산해 5장 값 확정. `muted-foreground`는 AA 대비 확보를 위해 frappe-ui 원본(ink-gray-4)보다 어둡게 보정.
- 2026-10-09: `@tanstack/react-table`은 저장소에 없고 이번 기능 범위가 작아 도입하지 않기로 결정(8.1).

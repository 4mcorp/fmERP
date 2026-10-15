---
title: UI/UX 2차 리팩토링 — 결재 상세·출력물·목록·관리콘솔 정리
date: 2026-10-15
status: draft
tags: [ui, ux, approval, completion, print, layout, admin]
related: [docs/plan/2026-10-09-ui-redesign-erpnext-reference.md, docs/rules/frontend.md, APV-036, APV-072, APV-073, AUD-020]
---

## 0. 이 문서의 위치
사용자 점검(2026-10-15, dev 76277d1 테스트 환경) 결과 나온 UI/UX 수정 요청 15건을 실행 단위로 나눈 계획이다. fmerp 칸반 보드의 하위 카드는 **이 문서만 보고** 구현한다. 공유 결정(컴포넌트 이름, props, 설정 키)은 모두 여기에 적었다. 이 문서와 어긋나는 선택이 필요하면 구현하지 말고 카드를 막고(block) 문서 수정을 요청한다.

기존 1차 스펙(`2026-10-09-ui-redesign-erpnext-reference.md`)의 토큰·`PageHeader`·`DataTable`·`StatusBadge`·`EmptyState`는 그대로 쓴다. 새 공용 컴포넌트는 `shared/src/ui/` 바로 아래 평면 파일로 둔다(하위 폴더 금지).

## 1. 요청 → 원인 위치 (조사 결과, dev 76277d1)
| # | 요청 | 현재 코드 | 원인 요약 |
|---|---|---|---|
| R1 | 참조·수신·공람 카드, 이력 카드를 토글(접기) 카드로 | `features/approval/src/ui/components/recipient-panel.tsx`, `features/audit/src/ui/components/audit-trail.tsx`(`DocumentTimeline`), 상세 `approval-detail.tsx` | 항상 펼친 `Card`라 높이를 많이 차지 |
| R2 | 넓은 화면에서 카드 2/3/…최대 5열, 본문 카드는 항상 1열 | `approval-detail.tsx` 루트 `space-y-4` | 세로 1열 스택만 있음 |
| R3 | 완료 출력물 결재란 축소, 최대 2줄·최대 15칸(관리콘솔 설정) 자동 맞춤 | `features/completion/src/service/pdf-html.ts` `approvalBox()`·CSS `td.cell{width:24mm}` | 한 줄 고정 폭 24mm, 칸 수 제한·줄바꿈 없음 |
| R4 | 출력물 좌·우 테두리 잘림 | 같은 파일 CSS `@page{margin:14mm 12mm}`, 표 `width:100%`+`border` | 100% 폭 + 테두리 두께가 인쇄 영역을 넘음, 안쪽 여백 없음 |
| R5 | 출력물에서 줄바꿈 사라짐(웹은 보임) | `pdf-html.ts` `renderField()`(textarea만 `\n→<br>`), `form-view.tsx`는 `whitespace-pre-wrap` | text 필드·리치텍스트 문단 안 `\n`을 HTML이 공백으로 접음 |
| R6 | 상신 후 출력도 완료 출력과 같은 A4 형식, 저장·인쇄 없이 미리보기 | `PrintButton`(`audit-trail.tsx`)이 `window.print()`로 웹 화면 인쇄, 완료 PDF는 `completion` 패키지 | 진행 중 문서는 A4 렌더 경로가 없음 |
| R7 | 기안함·문서함·검색 디자인을 문서함으로 통일, 검색 진입 시 열람 가능 문서 바로 표시 | `mine.tsx`(DataTable+Tabs), `mailbox.tsx`(DocumentTable), `search.tsx`(조건 폼 제출 후 조회) | 화면마다 목록 구성이 다름, 검색은 제출 전 빈 화면 |
| R8 | 문서함에서 읽은 문서는 연하게, 안 읽은 문서는 진하게 | `document-table.tsx`, `service/mailbox.ts`, 표 `document_recipient_read`(참조·공람만) | 목록 응답에 읽음 여부가 없음, 결재 문서는 열람 기록 표 없음 |
| R9 | 새 결재 > 양식: 카테고리 토글, 아이템 1열, 즐겨찾기 버튼은 카드 내부 우측 | `new-approval.tsx` `grid sm:grid-cols-2`, 별 버튼이 카드 밖 | — |
| R10 | 관리콘솔 > 양식 편집: 좌측 실시간 출력 미리보기, 우측 메타데이터·필드 | `admin-form-edit.tsx`(916줄) | 미리보기 없음 |
| R11 | 관리콘솔 > 조직관리 CSV 내보내기·가져오기 정렬 어긋남 | `features/org/src/ui/pages/admin-org.tsx` 440~470행 | 가져오기만 `div.space-y-1`+`Label`로 감싸 높이·기준선이 다름 |
| R12 | 관리콘솔 > 직위직책을 구성원 페이지 디자인으로 통일 | `admin-positions.tsx` vs `admin-members.tsx` | 목록·헤더·탭 구성이 다름 |
| R13 | 전 페이지 action 버튼(상신·다음·적용·저장 등) 우측 배치 + 배경색(주 버튼) | 각 페이지의 `flex gap-2` 버튼 줄(약 29곳) | 좌측 정렬, outline 혼용 |
| R14 | 페이지 내 탭 컨트롤 디자인 통일(R7·R12에서 정한 컴포넌트 사용) | `shared/src/ui/tabs.tsx` 사용처: `mine.tsx`, `admin-members.tsx`, `org.tsx`, `me-page.tsx` | 변형·배치 제각각 |
| R15 | 결재대기 페이지 비었을 때도 표 레이아웃 유지 | `pending.tsx` 19행 `EmptyState`만 렌더 | 빈 상태에서 표 머리줄 없음 |

## 2. 공유 결정 (모든 카드가 따른다)

### 2.1 새 공용 컴포넌트
- `shared/src/ui/collapsible-card.tsx` — `CollapsibleCard({ title, description?, defaultOpen = false, count?, actions?, children, className? })`. 머리줄 전체가 토글 버튼(`aria-expanded`, `aria-controls`), 접혀 있을 때 높이 = 카드 머리줄 1줄. `count`가 있으면 제목 옆 숫자 배지. 인쇄(`print:`)에서는 항상 펼친다.
- `shared/src/ui/card-grid.tsx` — `CardGrid({ children, className? })`. 열 수: 기본 1, `md:` 2, `xl:` 3, `2xl:` 4, `min-[1920px]:` 5(최대). 자식에 `CardGrid.Full`(= `col-span-full`) 래퍼를 쓰면 그 카드는 항상 한 행 전체(1열)를 차지한다.
- `shared/src/ui/action-bar.tsx` — `ActionBar({ children, className? })` = `flex flex-wrap items-center justify-end gap-2`. **규칙: 주 동작(상신·다음·적용·저장·확인)은 맨 오른쪽, `variant="default"`(배경색 있는 주 버튼). 보조(취소·이전·초기화)는 그 왼쪽 `outline`/`ghost`. 위험 동작은 `destructive`.** 모바일 360px에서도 오른쪽 정렬을 유지하고 넘치면 줄바꿈한다.
- 탭: 새로 만들지 않는다. `shared/src/ui/tabs.tsx`의 `Tabs`/`TabsList variant="line"`을 **페이지 내 보기 전환의 표준**으로 정하고, 탭 줄은 `PageHeader` 바로 아래 한 줄·가로 스크롤 허용(`overflow-x-auto`)으로 둔다. 카운트가 있으면 `TabsTrigger` 안에 배지.

### 2.2 목록 화면 표준 (문서함 디자인)
- 기준 화면: `features/approval/src/ui/pages/mailbox.tsx` + `components/document-table.tsx`.
- 기안함(`mine.tsx`)·검색(`search.tsx`)·결재대기(`pending.tsx`)는 `DocumentTable`을 그대로 쓴다(열 구성은 화면별 `columns` prop으로 고르되 머리줄·행 높이·상태 배지·빈 상태 모양은 같다).
- 빈 목록: 표 머리줄은 유지하고, 본문 한 행(`colSpan` 전체)에 `EmptyState`를 넣는다(R15). `DocumentTable`의 기본 동작으로 만든다.
- 읽음 표시(R8): `DocumentTable` 행에 `read?: boolean` 데이터가 오면 `read === true` 행은 `text-muted-foreground`(연한), `false`는 `font-semibold text-foreground`(진한). `read`가 없으면(undefined) 기본 스타일.

### 2.3 문서 출력(A4) 단일 경로
- 완료 PDF와 진행 중 문서 출력은 **같은 HTML 생성기** `features/completion/src/service/pdf-html.ts`의 `buildPdfHtml()`을 쓴다. 진행 중 문서는 `input.completedAt = null`을 허용하고, 머리에 "결재 진행 중(미완료)" 워터마크·미결 칸은 기존 `.pending` 모양으로 표시한다.
- 미리보기 API: `GET /api/approvals/{id}/print-preview` → `text/html`(A4 CSS 포함). 열람 권한은 기존 `shared/contracts/document-access`로 확인, 열람 불가면 404. 응답은 저장·S3 기록을 하지 않는다(final/ 한 번만 쓰기 불변 조건과 분리).
- 화면: 상세 페이지의 `PrintButton`은 이 미리보기를 모달(iframe, `sandbox="allow-same-origin allow-modals"`)로 먼저 보여 주고, 모달 안의 "인쇄" 버튼이 iframe의 `print()`를 부른다. 인쇄 기록(AUD-020)은 현재처럼 인쇄 시점에 남긴다. 미리보기만 열 때는 기록하지 않는다.
- 이 경로는 R10(양식 편집 실시간 미리보기)도 재사용한다. 기능 간 import 금지 규칙 때문에 **U3a에서 `pdf-html.ts`의 순수 HTML 생성부를 `shared/src/domain/document-print.ts`로 옮긴다**(`buildPdfHtml`, `PdfInput`, `PdfApprover` export). `features/completion/src/service/pdf-html.ts`는 이를 다시 export만 하는 얇은 파일로 남겨 기존 import를 깨지 않는다. 서버 전용 import(fs, S3, DB) 금지.

### 2.4 결재란 자동 맞춤 (R3)
- 새 계정 설정 `approvalLineMaxCells`(기본 15, 허용 범위 2~30, 기안 칸 포함). 저장 위치: `account` 표(`packages/db/src/schema/tenant.ts`)의 새 컬럼 `approval_line_max_cells integer not null default 15` + CHECK(2~30), forward-only 마이그레이션 `0022_*`. `AccountSettings`(`shared/src/lib/types.ts`)·`/api/account/settings`(org-routes) 읽기/쓰기, 관리콘솔 > 설정(`admin-settings.tsx`)에 숫자 입력 추가.
- 규칙: 칸 수 n(기안 포함) ≤ 한 줄 최대(= ceil(maxLineCells / 2))이면 1줄, 넘으면 2줄로 나눈다. 칸 폭 = 인쇄 폭 ÷ 줄당 칸 수, 상한 20mm·하한 11mm. 글자 크기는 칸 폭에 비례해 7~8.5pt. 서명·도장 이미지는 칸 폭의 85%까지.
- 결재선 지정 시 n > maxLineCells이면 기안 화면에서 막고 문구 "결재란은 최대 {n}칸까지입니다". 서버(`approval` 도메인)도 같은 검증을 한다.

### 2.5 출력물 테두리·줄바꿈 (R4·R5)
- 본문 래퍼에 `padding: 0 0.6mm`를 주고 모든 표·필드 박스를 `width: 100%; box-sizing: border-box`로 맞춘다. `@page` 여백은 그대로.
- 줄바꿈: `text` 필드와 리치텍스트 텍스트 노드의 `\n`도 `<br>`로 바꾼다. 필드 값 박스에 `white-space: pre-wrap` 추가. 웹(`form-view.tsx`)과 같은 결과인지 단위 시험으로 고정.

## 3. 카드 분해 (fmerp 보드, `completion_contract=4mcorp/fmERP` — 9장 참조)
| 카드 | 담당 | 범위 | 선행 |
|---|---|---|---|
| U0 계획 문서 PR | fmerp-reviewer | 이 문서와 INDEX 한 줄을 dev에 머지 | — |
| U1 공용 컴포넌트 | fmerp-coder | `collapsible-card`·`card-grid`·`action-bar`(2.1) + `DocumentTable` 빈 상태 표 유지·읽음 스타일 prop(2.2) | U0 |
| U2 결재 상세 레이아웃 | fmerp-coder | R1·R2: 수신 패널·이력·첨부·의견을 `CollapsibleCard`, `CardGrid` 배치, 내용·결재선은 `CardGrid.Full` | U1 |
| U3a 출력 생성기 이동·테두리·줄바꿈 | fmerp-coder | 2.3 이동(`shared/src/domain/document-print.ts`(import 경로 `@fmerp/shared/domain/document-print`)), R4·R5, 단위 시험 | U0 |
| U3b 결재란 자동 맞춤·최대 칸 설정 | fmerp-coder | R3 전체(2.4): 컬럼·마이그레이션·설정 API·관리콘솔 입력·결재선 검증·2줄 배치 | U3a |
| U4 진행 중 문서 A4 미리보기 | fmerp-coder | R6(2.3): 미리보기 API·모달·인쇄 기록 | U2, U3b |
| U5a 목록 화면 통일 | fmerp-coder | R7·R15: 기안함·검색·결재대기를 `DocumentTable`로, 검색 진입 즉시 열람 가능 문서 조회 | U1 |
| U5b 읽음/안읽음 표시 | fmerp-coder | R8(4장): `document_view` 표·upsert·목록 `read` 필드·스타일 | U5a |
| U6 새 결재 양식 선택 | fmerp-coder | R9 | U1 |
| U7 양식 편집 실시간 미리보기 | fmerp-coder | R10: 좌 미리보기(`document-print` 재사용), 우 메타·필드 카드, `lg:` 미만은 세로 배치 | U3a |
| U8 관리콘솔 조직·직위 정리 | fmerp-coder | R11·R12 | U1 |
| U9 action 버튼·탭 전면 정리 | fmerp-coder | R13·R14: 전 페이지 `ActionBar`·탭 표준 | U2, U4, U5b, U6, U7, U8 |
| U10 통합 시각 검증 | fmerp-reviewer | R1~R15를 1280px·360px로 확인, 출력물은 결재자 3/8/15명 A4 렌더 | U9, U3b |

각 구현 카드는 리뷰 흐름(코더 구현 → `kanban_request_review(reviewer='fmerp-reviewer')` → 리뷰어 검증·커밋·dev PR·CI)을 따른다. 같은 파일을 만지는 카드는 선행 관계로 직렬화했다(document-table: U1→U5a→U5b, 출력 생성기: U3a→U3b→U4, audit-trail: U2→U4).

## 4. 읽음 표시 데이터 (R8 상세)
- 참조·공람: 기존 `document_recipient_read`를 쓴다.
- 결재 문서(결재함·기안함): 새 표 `document_view(account_id, document_id, membership_id, first_viewed_at, last_viewed_at)` `@owner approval`, 문서 상세 조회 API에서 upsert. 마이그레이션은 forward-only. 목록 API는 `read: boolean`을 같이 준다.
- 이 표는 감사 로그가 아니다(열람 감사는 기존 audit 경로 유지).

## 5. 완료 기준
- `pnpm lint`, `pnpm typecheck`, `pnpm exec vitest run --project unit` 해당 기능, `pnpm arch:check` 통과. 화면·라우트·표가 바뀐 기능은 `feature.map.yaml` 갱신 + `pnpm feature:index`.
- U10에서 R1~R15 각각 1280px·360px 증거(스크린샷 경로) 기록. 출력물은 A4 세로에서 결재자 3명/8명/15명 세 경우 렌더.
- 미검증 항목은 미검증으로 남긴다(통과로 처리하지 않음).

## 6. 제외
- 결재 엔진 규칙 변경(결재란 칸 수 검증 외), 완료 PDF의 `final/` 한 번만 쓰기 규칙 변경, 다크 모드 재설계.
- 이미 생성된 완료 PDF 재생성(새 레이아웃은 이후 완료 문서부터 적용).

## 7. 위험
- `admin-form-edit.tsx`(916줄)와 `approval-detail.tsx`(762줄)는 여러 카드가 만진다 → U9는 마지막에 두고 앞 카드 머지 후 시작한다.
- 미리보기 iframe은 같은 출처 HTML만 렌더하고 사용자 입력은 `esc()`를 그대로 거친다(XSS 회귀 시험 필수).

## 8. 결정·변경 기록
- 2026-10-15 작성(default). 사용자 요청 15건 원문은 Discord 메시지 1560253989608624149.

## 9. 칸반 운영 메모
- 4mcorp/fmERP는 공개 저장소이고 dev 규칙 API가 응답한다(2026-10-15 확인). 구현 카드는 `--completion-contract 4mcorp/fmERP`로 만들고, 리뷰어가 PR URL 문자열을 `metadata.published_pr`에 남긴 뒤 필수 검사 통과로 완료한다.
- 카드는 `worktree` 작업공간·`wt/ui2-<id>` 브랜치, 선행 카드는 parent 링크로 묶는다. 선행 카드의 PR이 dev에 머지된 뒤 시작한다(작업 브랜치는 origin/dev에서 분기).
- 대체 PR이 생기면 리뷰어 규칙(`fmerp-review-loop` 대체 PR 정리)에 따라 이전 PR을 닫는다.

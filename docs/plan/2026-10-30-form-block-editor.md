---
title: 양식 빌더를 노션식 블록 편집기로 전환
date: 2026-10-30
status: in-progress
tags: [approval, forms, editor, ux]
related: [APV-001, docs/TECH_SPEC.md, docs/rules/dependencies.md]
---

## 배경·문제
- 현재 양식 편집(`features/approval/src/ui/pages/admin-form-edit.tsx`, 973줄)은 **필드 목록 편집기**와 **인쇄 미리보기**(`form-print-preview.tsx`)가 분리되어 있다.
- 사용자가 미리보기에서 고치고 싶은 항목을 본 뒤, 다시 필드 목록에서 같은 항목을 찾아 편집해야 한다(대상 확인을 두 번 함).

## 목표
- `/` 슬래시 명령으로 블록(필드)을 추가하고, 블록을 **그 자리에서 바로 편집**한다(편집 화면 = 결과 화면).
- 필드 목록 / 미리보기 이원 구조를 없앤다.

## 현재 구조 (조사 결과)
- 저장 모델: `shared/src/domain/form-schema.ts`의 `FormSchema { fields: FormField[] }` — 평면 필드 배열, 13종(text, textarea, number, money, date, daterange, select, multiselect, user, dept, table, richtext, attachment), 최대 100개, key 정규식·정규식 패턴 검증 포함.
- 렌더러 3곳: `form-fields`(입력), `form-view`(조회), `form-print-preview`(인쇄).
- 이미 스택에 **Tiptap 3.31.4**(`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`) 고정됨(TECH_SPEC 3장). `richtext` 필드가 이를 사용.
- 신규 패키지는 사용자 승인 + 최근 12개월 배포 + MIT/Apache/BSD/ISC 확인 필요(`docs/rules/dependencies.md`).

## 후보 패키지 (웹 조사, 미검증 항목 표시)
| 후보 | 장점 | 단점 |
|---|---|---|
| **Tiptap 3 (기존 스택)** + `@tiptap/suggestion`(슬래시) + 커스텀 NodeView | 새 엔진 불필요, 이미 승인·고정, MIT 코어, 노드 스키마를 우리 FormField에 1:1 매핑 가능 | 슬래시 메뉴·드래그 핸들·블록 UI를 직접 조립. 공식 드래그 핸들의 라이선스 상태는 **미확인** |
| BlockNote | 슬래시·드래그·툴바 기본 제공, 커스텀 블록 API(`createReactBlockSpec`) | 새 문서 모델 강제(우리 FormSchema와 변환층 필요), shadcn 디자인과 불일치, 코어 MPL-2.0·XL 패키지 GPL/상용 → 승인 필요 |
| Plate (Slate) | shadcn 기반 UI, 슬래시·드래그 내장 | 엔진이 Slate로 이원화(Tiptap과 중복), 번들·유지 비용 |
| Lexical | 성능·접근성 | 0.x(1.0 전 Breaking), 슬래시·블록 UI 직접 구현 |

잠정 권고: **Tiptap 3 직접 구성**. 이유 — 이미 승인된 스택이며 필드마다 React NodeView로 "입력 위젯 + 설정 팝오버"를 넣는 구조가 우리 도메인에 가장 맞다. BlockNote는 빠르지만 모델 변환·라이선스·디자인 부담이 크다. (사용 레퍼런스 충분성은 아래 "확인할 것" 참조)

## 설계 초안
- 편집기 문서 = `FormSchema`의 투영. 블록 1개 = `FormField` 1개. 저장 시 `validateFormSchema` 그대로 통과해야 한다(서버 계약 불변).
- 안내 문구·제목 등 **비필드 블록**(제목, 구분선, 설명 텍스트)을 허용할지는 결정 필요 → 저장 모델 확장 여부 연동.
- 블록 UI: 호버 시 드래그 핸들 + `+`, 선택 시 설정(필수·도움말·옵션·열 정의 등) 인라인 팝오버.
- 기존 필드 key 보존(이미 기안된 문서·검색 인덱스·금액 검색 기준 `searchAmount` 영향).

## 확인할 것 (조사 TODO)
- [x] drag-handle·suggestion 라이선스(MIT)·유지 상태 확인
- [ ] Tiptap NodeView 안에 폼 위젯(표 열 편집 등)을 넣은 공개 사례 (BlockNote 커스텀 블록 사례와 비교)
- [ ] 한국어 IME + 슬래시 메뉴 조합 입력 이슈 (Tiptap suggestion 이슈 트래커)
- [ ] Context7로 3.31 API 확인 후 PoC (별도 스파이크)

## 확정 요구사항 (2026-10-30 사용자 답변)
1. 블록: 기존 필드 13종 + 레이아웃 블록(제목·설명·구분선 등)
2. 배치: 기본 단일 열, 필요 시 다중 열
3. **편집 화면 = 인쇄 결과 100% 동일**(배치·크기·폰트·색상). 편집·작성·조회·인쇄가 한 렌더러
4. 기존 양식은 자동 변환만(구 편집기 병행 없음)
5. 작성 화면도 같은 렌더러. 작성자는 양식 구조 편집 불가, **값만 수정**
6. 모바일 지원: A4 비율 불필요, 줄바꿈 / 다중 열·표는 블록 영역 내 가로 스크롤. 노션 페이지 편집 수준 UX
7. 양식 버전은 사용자가 "저장"할 때 생성, 자동 저장(초안)도 지원

## 패키지 검증 결과 (npm view, 2026-10-30)
- `@tiptap/core`·`suggestion`·`extension-drag-handle`(+`-react`)·`extension-table`·`node-range`: 모두 **MIT, 3.32.2, 오늘 배포** → 드래그 핸들 라이선스 우려 해소. 현재 고정 3.31.4와 마이너 차이 → 승인 후 `~3.32` 정렬 필요.
- 공식 무료 `@tiptap/extension-columns` **없음**(404) → 다중 열 블록은 **자체 노드**(columns/column)로 구현.
- BlockNote: core 0.56.0 MPL-2.0이지만 `xl-multi-column`은 **GPL-3.0 OR PROPRIETARY** → 다중 열을 쓰려면 라이선스 승인 필요. 요구 2번 때문에 BlockNote 불리.
- 결론: **Tiptap 3 직접 구성 확정 권고**.

## 설계 쟁점 (구현 전 해결)
- 저장 모델 확장: `FormSchema.fields` 평면 배열 → 블록 트리(레이아웃 블록·columns). 서버 `validateFormSchema`·검색(`searchAmount`)·기존 문서의 값(key 기준) 호환 필요. 기존 양식은 평면→단일 열로 자동 변환.
- 단일 렌더러: 모드(`edit-layout` / `fill` / `view` / `print`) 속성으로 같은 컴포넌트를 쓰고, 모드별로 편집 가능 대상만 다르게 한다. 인쇄 동일성은 A4 고정 폭 캔버스 + 인쇄용 CSS를 편집·인쇄가 공유해 보장하고, 시각 회귀(Playwright 스크린샷 비교)로 검증.
- 모바일: 같은 문서를 폭에 맞춰 reflow, columns·table은 `overflow-x` 스크롤 컨테이너. 인쇄 동일성은 데스크톱/인쇄 기준.
- 자동 저장: 초안(draft) 별도 저장, "저장" 시에만 `form_version` 생성. 초안 저장 위치·충돌 처리 설계 필요.
- 한국어 IME + 슬래시 메뉴 조합 입력은 PoC에서 실측.

## 저장 모델 설계안 (초안)
**원칙: 값 계약은 건드리지 않고, 배치만 새로 얹는다.**
- `form_version.schema`(= `FormSchema.fields` 평면 배열)는 **그대로 둔다.** 값 저장(`form-values`)·검증·검색 색인(`form-index`, `searchAmount`)·기존 기안 문서가 모두 key 기준 평면 구조에 의존하므로 변경 범위를 0으로 만든다.
- 배치는 이미 있는 jsonb 컬럼 **`form_version.layout`**(현재 `orientation`·`approvalBoxPosition`)에 `blocks` 트리를 추가해 담는다. **DB 마이그레이션 없음.**
- 양식 버전은 불변(ADR 0008)이므로 기존 버전은 **읽을 때 변환**한다(재기록 없음): `layout.blocks`가 없으면 `schema.fields` 순서대로 단일 열 블록을 만들어 낸다 = "자동 변환만".

```ts
// layout (확장)
{
  orientation: "portrait" | "landscape",      // 기존. 양식 생성 시 사전 설정
  approvalBoxPosition: ...,                   // 기존 (문서 크롬: 편집 불가)
  blocks?: Block[]                            // 신규. 없으면 fields 순서로 파생
}
type Block =
  | { kind: "field"; key: string }            // schema.fields[key] 참조 (정의는 fields에)
  | { kind: "heading"; level: 1 | 2; text: string }
  | { kind: "text"; text: string }            // 설명 문구 (서식은 굵게/기울임 등 최소 인라인만)
  | { kind: "divider" }
  | { kind: "pagebreak" }                     // 수동 쪽 나눔
  | { kind: "columns"; cols: Block[][] }      // 2~4열, 열 안에 columns 중첩 금지
```
- 편집기(Tiptap) 문서 ↔ `{fields, layout.blocks}` 변환은 PoC의 `schema.js` 왕복 변환을 확장해 쓴다. 필드 설정(필수·옵션·열 정의)은 블록 노드 속성이 아니라 **fields 항목**에 저장한다(PoC는 노드 속성에 임시 보관).
- 렌더러 입력은 항상 `(fields, blocks)`. 편집·작성·조회·PDF 모두 같은 `renderBlocks()`를 쓴다(모드: edit / fill / view / print). `buildPdfHtml`의 필드 루프를 이 함수로 교체한다.

**서버 검증 추가 (`validateFormSchema` 확장 → `validateFormLayout`)**
1. `blocks`의 모든 `field.key`는 `fields`에 존재하고, `fields`의 모든 key는 **정확히 한 번** 배치된다(누락·중복 금지).
2. `columns`: 열 수 2~4, 중첩 금지. 블록 총수 상한(예: 300), 텍스트 길이 상한, `heading.level` 범위.
3. `layout.orientation`는 `portrait|landscape`만.
4. `text`/`heading`은 **순수 텍스트**로 저장(HTML 저장 금지 → XSS·PDF 주입 방지). 서식이 필요하면 허용 마크 목록(bold/italic)만 구조화 필드로 둔다.
5. `table`/`richtext`/`attachment`는 `columns` 안에 두는 것을 허용하되 열 폭 하한(예: 40mm)보다 좁아지는 구성은 저장 시 경고(막지 않음, 강제 분할 허용 결정과 일치).

**호환·영향**
- 기존 기안 문서·완료 PDF: `formVersionId`로 옛 버전을 참조하므로 영향 없음(재생성 안 함).
- `form-index`/`form-values`/`searchAmount`: 변경 없음.
- 영향 파일(예상): `shared/src/domain/form-schema.ts`(검증), `document-print.ts`(블록 렌더), `form-fields.tsx`·`form-view.tsx`·`form-print-preview.tsx`(공통 렌더러로 통합 후 제거), `admin-form-edit.tsx`(편집기로 교체), `forms.ts`·`forms-routes.ts`(layout 검증), `feature.map.yaml`.
- 기존 PDF의 필드 배치 규칙(`.field.wide` 전폭, 나머지 라벨-값 가로 배치)은 자동 변환 시 **단일 열 + 라벨/값 가로형**으로 동일하게 재현한다. 결과가 현재 PDF와 달라지는 부분은 사용자가 허용한 회귀 범위 내.

**문서 크롬(결재선 표·문서번호·푸터·해시)**: 블록이 아니라 **고정 영역**. 편집 화면에서는 샘플 값으로 표시하고 편집 불가. 위치 옵션은 기존 `approvalBoxPosition`만 유지.

**초안·자동 저장**: 버전과 분리해 **양식 초안 테이블**(예: `form_draft`, `account_id`+RLS, 양식당 작성자별 1건, `schema`+`layout` jsonb, `updated_at`, 낙관적 락용 `revision`)을 둔다. 자동 저장은 초안만 갱신하고 `form_version`은 "저장" 시에만 생성. 새 테이블이므로 `@owner` 주석·`feature.map.yaml` 선언 필요. 동시 편집은 `revision` 불일치 시 거절+안내(실시간 협업은 범위 밖).

**결정 완료 (2026-10-30)** — 아래 3건 확정(권고안 채택)
1. 초안을 별도 테이블로 둘지, 기존 `form` 행의 jsonb 컬럼 1개로 둘지(스키마 변경량 vs 이력). **확정: 별도 테이블 `form_draft`.**
2. 한 사람이 같은 양식 초안을 여러 탭에서 열 때 정책(마지막 저장 우선 vs 거절). **확정: `revision` 불일치 시 거절+안내.**
3. 기존 PDF의 필드 가로 배치를 자동 변환에서 완전 재현할지→ **확정: 완전 재현**(단일 열 + 라벨/값 가로형, `.field.wide` 전폭 규칙 유지).

## 단계
- [x] 0. 요구사항 확정, 패키지 조사, PoC(슬래시·열·왕복 변환·IME 시뮬레이션·쪽 경계 마진)
- [x] 1. 문서 등록: 계획 문서·INDEX 반영. **Tiptap은 3.31.4 유지**(3.32.x 정렬은 하지 않음). 신규 패키지는 실제로 쓰는 5단계에서 추가(Knip 미사용 의존성 게이트)
- [ ] 2. 도메인: `Block` 타입, `validateFormLayout`, 평면→블록 파생(`deriveBlocks`), 단위 테스트(누락·중복·열 제한·텍스트 상한)
- [ ] 3. 공통 렌더러 `renderBlocks()`(edit/fill/view/print) + 쪽 나눔 CSS 규칙 + Pretendard 고정(웹폰트·PDF 동일 파일). `buildPdfHtml` 교체, 기존 PDF 배치 재현 테스트
- [ ] 4. DB·API: `form_draft` 테이블(RLS, `revision`), 초안 저장/조회 API, 버전 생성은 "저장"만, 서버 layout 검증 연결
- [ ] 5. 편집기(+의존성 추가: `@tiptap/core`·`suggestion`·`extension-drag-handle(-react)`·`node-range`와 drag-handle 필수 peer `extension-collaboration`·`@tiptap/y-tiptap` 모두 `~3.31.4` 계열, 공급망 대기 통과 버전만): 슬래시·드래그 핸들·인라인 설정·columns 노드·쪽나눔 블록·페이지 경계(보수 마진)·문서 크롬(편집 불가)·라이트 고정·모바일 reflow, 자동 저장
- [ ] 6. 작성(fill)·조회(view) 화면 통합(구조 편집 불가, 표 행 추가·삭제 허용)
- [ ] 7. 검증: 쪽 경계 하네스 자동화(마진 재확정), 잘림 시나리오 PDF 테스트, 실제 한글 IME 수동 확인, E2E, `pnpm verify`
- [ ] 8. 구 편집 UI 제거, `feature.map.yaml`·INDEX·ADR 갱신

## 완료 기준
- 모든 기존 양식이 새 편집기에서 열리고, 저장 결과가 `validateFormSchema`를 통과한다.
- 슬래시로 블록 추가 → 같은 자리에서 설정 편집 → 저장까지 별도 목록 참조 없이 가능(E2E).
- `pnpm verify` 통과.

## 결정·변경 기록
- 2026-10-30: PoC 진행 승인. 저장소 의존성은 건드리지 않고 스크래치 디렉터리에서 스파이크한다(버전은 현행 3.31.4 유지로 변경, 아래 기록 참조).
- 2026-10-30: 문서 용지는 **양식 생성 시 사전 설정**(A4 세로/가로). 용지 설정은 양식(버전) 메타로 저장하고 편집·작성·조회·인쇄가 공유한다. 다른 용지 크기는 이번 범위 밖.
- 2026-10-30: 작성 모드에서 표 **행 추가·삭제는 허용**(값 편집으로 취급). 열 구조·블록 구조 편집은 불가.
- 2026-10-30: **PoC 결과** (스크래치 `~/.hermes/cache/scratch/form-poc`, Tiptap 3.32.2 + React 19, 저장소 무변경)
  - 통과: 기존 `FormSchema`(text·select·table) → 블록 문서 → 블록 트리/평면 필드 왕복 변환(값 동일)
  - 통과: `/` 슬래시 메뉴(한글 검색), 필드·2열 블록 삽입, **열 안 필드 삽입**(트리 `columns→column→field`), 필드 NodeView 인라인 편집(라벨·필수·도움말·선택지)
  - 통과: A4 세로 210×297mm / 가로 297×210mm 전환 실측
  - 통과: 390px 모바일 폭에서 가로 넘침 없음(columns는 `overflow-x` 컨테이너)
  - 통과(시뮬레이션): CDP `imeSetComposition`으로 한글 조합 중에도 메뉴가 갱신되고 확정 후 Enter 삽입 성공
  - **미검증**: 실제 OS IME(macOS/Windows 한글 입력기) 실기 테스트, 드래그 핸들로 실제 이동, 편집 화면 vs 인쇄 결과 픽셀 동일성, 표 열 구조 편집 UI, 모바일 터치 드래그, 자동 저장
- 다음: 위 미검증 항목 중 **인쇄 동일성**(공유 CSS + 스크린샷 비교)과 **실제 IME**를 본 구현 전 게이트로 둔다.
- 2026-10-30: **출력 일관성 결정** (사용자 답변)
  - "100% 픽셀 동일"은 요구에서 제외. 대신 **출력(서버 PDF)에서 블록이 잘려 보이는 경우가 없어야 한다**(아래 검토).
  - 글꼴 **Pretendard 고정**: 화면(웹폰트)과 서버 PDF가 같은 woff2를 쓴다. 라이선스(SIL OFL)·용량은 구현 시 확인.
  - 문서 크롬(결재선 표·문서번호·푸터·해시)은 편집 화면에도 표시하되 **편집 불가 영역**(샘플 값).
  - 편집 화면에 **페이지 경계를 명확히 표시**한다.
  - 모바일은 같은 컴포넌트·글꼴·색상만 보장(A4 비율 제외).
  - 편집기 내부는 **다크 모드 배제**(라이트 고정, 출력 오해 방지).
  - 공식 출력은 **서버 PDF 하나**(`window.print` 미사용).
  - 기존 완료 PDF는 재생성하지 않고 새 양식 버전부터 적용.
- 2026-10-30: **잘림 검토 (현행 `buildPdfHtml` 코드 확인)** — `break-inside: avoid`는 결재선 표에만 있고, 필드 행·표 행·리치텍스트에는 규칙이 없다. 표 `thead`는 Chromium 기본으로 쪽마다 반복된다. 따라서 현행 구조는 필드 라벨/값 분리, 표 행 가로 절단이 생길 수 있어 **새 렌더러에서 규칙을 정의해야 한다**.
- 2026-10-30: **쪽 나눔 결정** (사용자 답변)
  - 한 쪽보다 큰 블록은 **강제 분할 허용**(저장을 막지 않는다). 다만 아래 규칙(`break-inside: avoid` 등)은 "가능하면 피한다"로 적용하고, 불가능할 때 분할된다.
  - 편집 화면 쪽 경계는 **클라이언트 CSS 근사**. 브라우저·엔진 오차를 고려해 **편집 가능 영역을 보수적으로**(실제 PDF 본문 영역보다 안쪽 여유 마진을 두고 경계를 그린다). 서버 사전 계산은 하지 않는다.
  - **수동 쪽 나눔 블록**(슬래시 `/쪽나눔`)을 제공해 사용자가 직접 제어한다. 편집 화면에서는 점선+라벨로 표시하고 PDF에서는 `break-after: page`로 출력한다.
  - 미결: 보수 마진 크기(PoC에서 화면 경계 vs 실제 PDF 쪽 나눔 차이를 실측해 결정), 강제 분할 시 편집기 경고 표시 여부.
- 2026-10-30: **쪽 경계 보수 마진 PoC** (스크래치 `form-poc/pagetest.html`, Chromium `Page.printToPDF` + pypdf, A4 세로 여백 14×12mm, 블록 70개: 필드·긴 텍스트·2열·표(행 단위 분할)·수동 쪽 나눔 1개)
  - 방법: 화면에서 측정한 블록 높이로 "블록이 남은 공간보다 크면 다음 쪽" 규칙(CSS 근사)을 시뮬레이션해 쪽 번호를 예측하고, 실제 PDF에서 각 블록이 처음 나타나는 쪽과 비교.
  - 본문 높이 269mm(297−28)로 예측: 70개 중 **1건 불일치**(B33) — PDF가 화면 예측보다 블록을 **다음 쪽으로 더 밀었다**(위험 방향: 화면에선 들어가 보이는데 출력은 넘어감).
  - 본문 높이를 266mm 이하(여유 3mm 이상)로 보수화하면 불일치 **0건**. 264·265도 0건. 262mm부터는 화면이 일찍 넘기는 쪽(안전 방향) 불일치가 생기기 시작(262: 1건, 260: 2건).
  - 잠정 결론: **편집 화면 쪽 경계는 본문 높이에서 약 3mm를 뺀 값(≈266mm)** 으로 그린다. 쪽당 3mm 안팎의 누적 오차를 흡수.
  - 한계: 단일 문서·단일 엔진(Chromium)·시스템 글꼴 사용(Pretendard 미적용)·n=70이므로 통계적 근거는 약함. 가로 용지·다중 열 안의 큰 블록·긴 표 머리글 반복·Pretendard 적용 후 재측정 필요. 본 구현 때 같은 하네스를 자동 테스트로 승격하고 마진을 재확정한다.
  - 확인된 동작: `break-inside: avoid` 블록은 쪽 경계에서 잘리지 않고 통째로 다음 쪽으로 이동, 표는 행 단위로만 분할되고 머리글 반복, 수동 쪽 나눔(`break-after: page`) 정상.
- 2026-10-30: 저장 모델 3건 확정 — 초안 별도 테이블(`form_draft`), 동시 편집은 `revision` 거절, 기존 PDF 필드 배치 완전 재현. 설계 단계 종료, 구현 단계(1~8)는 별도 착수 승인 후 진행.
- 2026-10-31: **버전 정정** — PoC는 스크래치라 최신 3.32.2를 썼지만, 저장소는 pnpm `minimumReleaseAge`(배포 24h 경과) 정책이 있어 3.32.2(10-30 배포)를 설치할 수 없었다. **3.31.4 유지**로 결정(사용자 승인). 신규 패키지는 Knip 미사용 의존성 게이트 때문에 소비 코드와 함께 5단계에서 추가. drag-handle 필수 peer `extension-collaboration`·`@tiptap/y-tiptap` 추가를 승인 범위에 포함. y-tiptap은 `^3.0.7` 범위에서 대기 통과 버전을 선택(최신 3.0.12는 10-30 배포라 부적합). PoC 검증(3.32.2)은 3.31.4에서 5단계 시작 시 재확인.

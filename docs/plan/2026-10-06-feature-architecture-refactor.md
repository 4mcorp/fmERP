---
title: 기능(feature) 단위 구조 전환과 정적 분석 강제 체계
date: 2026-10-06
status: accepted
tags: [architecture, lint, ci, refactor, feature-map, eval]
related: [rules/architecture.md, rules/dependencies.md, TECH_SPEC 4장, M8 plan]
---

> 상태: **확정(2026-10-06, 사용자가 10장 질문 Q1~Q9에 답함).** 도구 4종은 설치했고(8장) 코드 이전은 아직 시작하지 않았다. 이전은 **세션을 나눠** 진행한다(12장). 세션이 바뀌어도 이 문서 12장의 "다음 세션 시작 지침"만 읽으면 이어갈 수 있게 유지한다.

## 1. 목적과 원칙
에이전트의 작업 품질이 흔들려도 **산출물이 동작한다는 믿음이 규칙·스킬이 아니라 실패하는 검사에서 나오게** 한다. 이후 제3의 평가 에이전트가 점수를 매기는 반복 개발 루프(9장)를 얹을 수 있는 바탕이기도 하다.

| # | 원칙 | 확인 방법 |
|---|---|---|
| R1 | 규칙은 소프트(문서·스킬)가 아니라 **하드(린트·CI·컴파일)** 로 강제한다. 문서는 하드 검사가 있는 규칙만 "규칙"이라 부른다 | 모든 규칙에 대응하는 실패 검사가 있다 (4장 표) |
| R2 | **가장 짧은 경로가 최적**: 기능 하나를 고치려면 `features/<기능>/`과 `shared/`만 읽으면 된다 | 기능 격리 검사 — 그 두 곳만으로 타입 검사·테스트가 통과한다 (7.3) |
| R3 | 기능 간 직접 import는 **금지**하고 4겹으로 막는다: 패키지 경계(컴파일) · Biome(에디터) · dependency-cruiser(CI, 해석된 경로) · 구조 검사기 | 위반 0건, 우회(억제 주석·규칙 파일 수정) 감지 |
| R4 | 수정 대상을 매번 탐색하지 않는다: **feature map**을 사전에 만들어 두고 CI가 최신 상태를 보장한다 | 지도가 낡으면 CI 실패 (5장) |
| R5 | 게이트 결과는 **기계가 읽는 JSON**으로 남긴다 (평가 단계의 입력) | `quality-report.json` (9장) |

## 2. 현황 진단
측정 방법: 경로 규칙으로 파일을 기능에 배정하고(임시 스크립트, 이 문서에 맞춘 **1차 추정 매핑**), 실제 `import`/`export … from`을 해석해 기능 사이를 건너는 것만 센다. 테스트 파일과 공유로 볼 수 있는 인프라(db·audit·storage·ui·http)는 제외했다. 숫자는 방향을 보여 주는 값이고 정확한 기준선은 P0 단계에서 도구로 다시 잡는다.

**구조:** 지금은 **기술 계층별**이다. 한 기능이 `apps/web/server/{approval,routes}`, `apps/web/components`, `apps/web/app`, `apps/web/lib`, `packages/{core,completion,…}`, `apps/worker`에 흩어져 있다. 예: "알림"을 고치려면 8곳(`packages/core`, `packages/notification`, `packages/db`, `apps/worker`, `apps/web/server/{routes,notifications}`, `apps/web/components/me`, `apps/web/app`)을 봐야 한다.

| 영역 | 비테스트 파일 수 | 줄 수(테스트 포함) |
|---|---|---|
| `apps/web/server` | 59 | 18,911 |
| `apps/web/app` + `components` + `lib` | 36 + 35 + 7 | 14,000 |
| `packages/core` | 30 | 7,374 |
| 그 밖의 `packages/*`, `apps/worker` | 약 75 | 약 12,000 |

**기능 간 결합(1차 추정):** 97개 import 문이 33쌍의 기능을 건넌다. (S2에서 `tools/`로 정식화한 측정은 배럴을 이름 단위로 풀고 파일 쌍으로 세어 **48쌍**이 나온다. 아래 표는 처음 추정이고, 정식 기준선은 12장 S2 기록을 따른다.)

| 쌍 (건수) | 해석 |
|---|---|
| 문서함→결재 11, 양식↔결재 7·7, 결재→문서함 7, 문서함→양식 2 (합 34) | 결재·양식·문서함은 사실상 **한 덩어리**. 처음에는 하나의 기능으로 묶는다 |
| 백업→완료 6, 완료→결재 5, 결재→완료 4 | 완료 패키지가 결재 문서 구조를 직접 읽는다 → **계약(contract)** 으로 분리 |
| 결재→조직 5, 조직→계정 5, 문서함→조직 4, 계정→조직 3 | 권한 판정(`org-access`)·계정 기능이 공통 성격 → **공통 영역으로 승격** 후보 |
| 감사→결재 4, 알림→백업 2, 계정→알림 1 … | 개별 계약 또는 이벤트로 분리 |

**이미 있는 강제:** Biome `noRestrictedImports`가 `packages/core`의 순수성과 S3 SDK 접근을 막는다. CI는 Biome·`tsc`·단위/통합/E2E 테스트를 돌린다. **없는 것:** 기능 경계 검사, 사용하지 않는 코드/의존성 검사, 순환 의존 검사, 문서·지도와 코드의 일치 검사, 규칙 우회 방지.

## 3. 목표 구조

### 3.1 폴더
```
features/                         # pnpm 워크스페이스 (기능마다 패키지 하나: @fmerp/feature-<이름>)
  approval/                       # 기안·결재 엔진·양식·문서함·검색·수신 (처음엔 한 기능)
  org/  account/  audit/  backup/  completion/  notification/  home/
    feature.map.yaml              # 5장 — 기능·화면·DOM·접근 경로·API·테이블 색인
    package.json                  # 의존은 @fmerp/shared 와 외부 라이브러리뿐 (다른 기능을 선언할 수 없다)
    src/
      domain/                     # 순수 규칙 (현 packages/core의 해당 부분). DB·네트워크·프레임워크 import 금지
      service/                    # 업무 로직, DB 접근 (withTenant)
      api/                        # Hono 라우트 + zod 스키마. routes.ts 가 register 함수를 내보낸다
      ui/                         # pages/ (Next 페이지 본체), components/, queries.ts
      jobs/                       # worker 작업 (있을 때). jobs.ts 가 register 함수를 내보낸다
    tests/                        # 단위(*.test.ts)·통합(*.int.test.ts)·E2E(*.spec.ts)
shared/                           # 공통 영역 (@fmerp/shared). 기능이 참조할 수 있는 유일한 외부
  db/ (= 현 packages/db: Drizzle 스키마 **전체**, client, withTenant, 마이그레이션 — 결정 Q6)
  authz/ (can(), 세션 컨텍스트)  http/ (Hono 공통, problem+json)  audit/ (recordAudit)
  storage/  env/  ui/ (shadcn 기본 컴포넌트)  contracts/ (기능 사이 계약 타입·포트)  testing/
apps/web/                         # 합성 루트 ①: app/ 은 얇은 어댑터, server/app.ts 가 각 기능의 routes 를 등록
apps/worker/                      # 합성 루트 ②: main.ts 가 각 기능의 jobs 를 등록
packages/db/                      # 공통 영역의 일부(이름 유지). 스키마·마이그레이션 전부가 여기에 있다
tools/                            # 자체 검사 도구 (arch-check, feature-map, guard)
```
- Next.js의 `app/` 폴더는 라우트 파일이 있어야 하므로 남기되, `page.tsx`는 `export { default } from "@fmerp/feature-x/ui/pages/…"` 한 줄짜리 어댑터로 만든다. 실제 화면 코드는 기능 폴더에 있다.
- **합성 루트만** 여러 기능을 import할 수 있다(`apps/web/app`, `apps/web/server/app.ts`, `apps/worker/src/main.ts`). 이 파일들은 `features/*`의 지정된 진입점(`routes`, `jobs`, `ui/pages/*`)만 import한다.

### 3.2 의존 방향 (이 표가 곧 검사 규칙이다)
| from \ to | 같은 기능 | 다른 기능 | `shared` | 합성 루트 | 외부 라이브러리 |
|---|---|---|---|---|---|
| 기능 `domain/` | ✅ | ❌ | ✅ (`shared/domain`만) | ❌ | 순수 라이브러리만 (DB·프레임워크·`node:*` 금지) |
| 기능 `service/ api/ ui/ jobs/` | ✅ | ❌ | ✅ | ❌ | ✅ (S3 SDK 등은 `shared/storage` 경유) |
| `shared` | – | ❌ | ✅ | ❌ | ✅ |
| 합성 루트 | – | ✅ (진입점만) | ✅ | – | ✅ |
| 테스트 | ✅ | ❌ (E2E 제외) | ✅ | ❌ | ✅ |
- 순환 의존은 어디서나 금지한다.
- 한 기능이 다른 기능을 **필요로 하는** 경우는 세 방법 중 하나로 푼다. 직접 import는 선택지가 아니다.
  1. **공통 영역으로 승격** — 여러 기능이 같은 규칙을 쓴다면 처음부터 공유 대상이다 (예: 권한 판정 `can()`, 감사 기록 `recordAudit`).
  2. **계약 + 주입** — `shared/contracts/<이름>.ts`에 타입과 포트(함수 시그니처)만 두고, 제공 기능이 구현을 합성 루트에서 주입한다 (예: 완료 패키지가 읽는 "결재 문서 스냅샷", 알림이 읽는 "문서 제목·결재자 목록").
  3. **이벤트** — 이미 있는 `approval_event` outbox처럼 DB를 통한 비동기 전달. 이벤트 형식은 `shared/contracts`의 zod 스키마로 고정한다.

### 3.3 기능 후보와 현재 위치
| 기능 | 담는 것 | 현재 흩어진 곳 | 파일 수(추정) | 난이도 |
|---|---|---|---|---|
| `notification` | 인앱·텔레그램 알림, 수신 어댑터, 운영 알림 | `packages/notification`, `core/notification-rules`, `worker/notification-jobs`, `server/{routes,notifications}`, `components/me/telegram-section`, `app/(app)/{notifications,system/telegram}` | 18 | S (가장 최근·경계 뚜렷 → **시범**) |
| `audit` | 감사 로그 조회·타임라인·월간 점검 | `server/audit`, `routes/audit`, `core/audit-*`, `app/admin/audit`, `components/approval/audit-trail` | 9 | S |
| `backup` | 덤프·내보내기·복구 | `packages/backup`, `worker/{backup-*,cli}`, `server/system`, `account-export`, `app/{system,admin}/backups` | 24 | M |
| `completion` | 완료 PDF·패키지 | `packages/completion`, `worker/package-jobs·render`, `routes/package`, `approval/package-download` | 16 | M (결재와 계약 필요) |
| `account` | 로그인·계정·초대·세션·PIN·내 정보 | `packages/auth`, `routes/{auth,me,accounts,reauth}`, `components/me`, `app/{login,dev-login,invite,onboarding,me}` | 25 | M (`shared/authz` 선행) |
| `org` | 사업자·부서·구성원·직위·역할 | `routes/{org,departments,members}`, `org-access`, `in-flight`, `core/{department-*,assignment,permissions}`, `components/org`, `app/{org,admin}` | 24 | M |
| `approval` | 기안·결재 엔진·양식·문서함·검색·수신 | `server/approval`, `routes/{approvals,documents,forms,mailbox,search,recipients}`, `core/approval-*`, `components/approval`, `app/{approval,mailbox,search}` | 62 | L (**마지막**) |
| `home` | 홈 대시보드, 앱 셸 | `app/(app)/page.tsx`, `app-shell` | 4 | S |

`approval` 안의 양식·문서함은 서로 얽혀(34건) **한 기능으로 두고, 하위 영역이 한 스코프를 공유한다**(결정 Q2). 내부는 `approval/src/{engine,forms,mailbox}/`로 폴더를 나눌 수 있지만 이는 읽기 편하라는 뜻일 뿐, 하위 영역 사이에는 경계 검사를 두지 않는다. 분리는 필요가 생길 때 별도 계획으로 한다.

### 3.4 DB와 마이그레이션 (결정 Q6: Drizzle 선언은 공통 영역에 한 번에)
- Drizzle 스키마(테이블 정의)와 마이그레이션은 **기능별로 나누지 않고 공통 영역(`packages/db`)에 그대로 둔다.** 기능 폴더에 `schema.ts`가 없으므로 기능 간 외래 키도 평소처럼 Drizzle 코드로 선언한다(SQL로 따로 빼는 예외가 없다). 복잡도를 늘리지 않는 방향이다.
- **대가와 보완:** 스키마가 공통 영역에 있으면 어느 기능이든 다른 기능의 테이블을 `schema.document`처럼 바로 읽고 쓸 수 있다. 파일 import 경계만으로는 이 **데이터 수준의 결합**을 못 막는다. 그래서 **테이블 소유권 검사**를 `tools/arch-check`에 추가한다.
  1. 스키마의 모든 테이블 정의에 `@owner <기능|shared>` 주석을 단다(없으면 실패).
  2. 기능 코드가 `schema.<테이블>`로 접근하는 것을 정적으로 모아(AST) **쓰기**(insert·update·delete)는 소유 테이블과 `shared` 테이블에만 허용한다.
  3. **읽기**는 소유 테이블, `shared` 테이블, 그리고 `feature.map.yaml`의 `tables.reads`에 **선언한** 다른 기능의 테이블에만 허용한다. 선언하면 지도에 남아 "누가 누구의 데이터를 읽는가"가 드러난다.
  4. 읽기 선언이 많은 기능은 계약(`shared/contracts`)으로 바꿀 후보로 보고한다.
- 마이그레이션은 선형 하나로 유지하고, 새 마이그레이션 첫 줄에 `-- feature: <이름>` 주석을 요구한다(영향 범위 추적용, 구조 검사기가 확인).
- 테넌트 격리 테스트(`rules/database.md`)는 기능 폴더의 `tests/`로 옮기고, 새 `account_id` 테이블의 소유 기능에 격리 테스트가 없으면 구조 검사기가 실패시킨다.

### 3.5 보존해야 하는 불변 조건
CLAUDE.md의 불변 조건은 구조가 바뀌어도 같은 강도로 유지한다: 테넌트 격리(`account_id`+RLS), `audit_log` INSERT 전용, `final/` 한 번만 쓰기, **`domain/` 순수성**(지금의 `packages/core` 규칙을 `features/*/src/domain/**`과 `shared/domain/**`에 적용), 비밀정보 금지. 이를 지키는 기존 테스트(통합 418건 중 해당 부분)가 이전 단계마다 그대로 통과해야 한다.

## 4. 정적 강제 체계
도구마다 잘 잡는 것이 달라 겹쳐 쓴다. "실패 시점" 열이 개발 루프의 어디서 막히는지를 보여 준다.

| 층 | 도구 | 막는 것 | 실패 시점 |
|---|---|---|---|
| L0 컴파일 | **기능별 pnpm 패키지 + TypeScript** (`strict`, `noUncheckedIndexedAccess` 등 기존 옵션 유지) | 다른 기능 패키지를 `package.json`에 선언하지 않으면 `@fmerp/feature-x` import 자체가 해석되지 않음(strict node_modules) | `tsc`, 에디터 |
| L1 린트 | **Biome**(기존 2.5) — 기능별 `noRestrictedImports` `patterns` 오버라이드를 **스크립트로 생성**, 필요하면 `noPrivateImports`(`@package` 주석) | `../../org/…`, `@fmerp/feature-org` 같은 지정자 수준의 위반을 에디터에서 즉시 표시. GritQL 플러그인으로 `process.env` 직접 접근(→ `shared/env`), `console.*` 등 프로젝트 고유 금지 패턴 | 에디터, pre-commit |
| L2 의존 그래프 | **dependency-cruiser** | **해석된 실제 경로** 기준의 기능 간 import(상대 경로로 패키지 경계를 넘는 우회 포함), `shared`→기능 역방향, 합성 루트 이외의 다중 기능 import, 순환, `domain` 순수성, 프로덕션 코드→테스트 import | CI(+ pre-push) |
| L3 사용되지 않는 코드 | **Knip** | 쓰이지 않는 파일·export·의존성, 선언 안 된 의존성 → 에이전트가 만든 죽은 코드와 "만들어 놓고 연결 안 한" 코드 | CI |
| L4 구조·정합성 | **`tools/arch-check`** (자체 스크립트, Vitest `architecture` 프로젝트) | 기능마다 필수 구성(`feature.map.yaml`, `tests/`, 진입점) 존재, 마이그레이션의 `-- feature:` 태그, 새 `account_id` 테이블의 격리 테스트 존재, `shared`에 있는 모듈이 한 기능에서만 쓰이면 역승격 경고 | CI |
| L5 지도 정합성 | **`tools/feature-map`** | 지도의 파일·라우트·테이블·DOM 식별자가 코드에 실제로 있는지, 코드에 있는 라우트·API가 지도에 빠지지 않았는지 | CI |
| L6 우회 방지 | **`tools/guard`** + GitHub **CODEOWNERS**/브랜치 보호 | `biome-ignore`·`@ts-expect-error`·`@ts-ignore`·`eslint-disable` 개수 증가, dependency-cruiser 기준선 증가, 린트·CI·도구 설정 파일 변경(사람 승인 없이는 병합 불가) | CI, 병합 시 |
| L7 동작 증거 | **Vitest**(기존) + 커버리지 하한(`@vitest/coverage-v8`) + OpenAPI 계약 스냅샷 + `drizzle-kit check` + (선택) **Stryker** 변이 테스트(`domain/`만, 야간) | 통과하지만 아무것도 검증하지 않는 테스트(변이 점수), API·DB 변경이 선언과 어긋남 | CI(야간 포함) |

### 4.1 dependency-cruiser 규칙 초안 (이름과 뜻)
`no-cross-feature` · `shared-must-not-import-features` · `feature-imports-only-shared` · `only-composition-roots-import-entrypoints` · `domain-is-pure` · `no-circular` · `no-test-in-production` · `no-undeclared-or-dev-deps-in-prod` · `no-orphans`. 모두 `severity: error`.

**도입 방식 — 기준선 래칫:** 현재 위반(약 97건)을 기준선 파일로 고정하고 **새 위반·기준선 증가를 즉시 실패**시킨다. 단계가 끝날 때마다 기준선이 줄어야 하고(줄지 않으면 해당 단계는 미완료), 마지막 단계에서 기준선을 삭제해 위반 0건을 강제한다. 이렇게 하면 이전 중에도 "새로 더 나빠지지 않는다"는 보장이 있다.

### 4.2 CI 단계 (빠른 정적 → 느린 동적, 앞 단계 실패 시 뒤는 실행하지 않음)
1. `biome ci` · `tsc`(기능별 `typecheck`, 영향받는 것만) · `depcruise` · `knip`
2. `arch-check` · `feature-map check` · `guard`(PR 변경 분석) · `drizzle-kit check` · OpenAPI 계약 비교
3. 단위 테스트(+커버리지 하한) → 통합 테스트 → E2E
4. **기능 격리 검사**(7.3)
5. `quality-report.json` 생성·업로드(모든 단계의 결과 요약, 실패해도 생성)
- 에이전트가 로컬에서 같은 검사를 돌리도록 `pnpm verify`(1~2단계), `pnpm verify:all`(전체)을 루트 스크립트로 둔다. CI와 로컬이 같은 명령을 쓴다.

## 5. Feature map
**사용자가 들은 "플러그인/스킬"에 대해:** 이름이 정확히 `feature map`인 기성 도구는 찾지 못했다. 비슷한 것으로는 코드를 읽어 `_FEATURES.md`를 만들어 주는 스킬(예: `mapping-webapp`), 저장소 지도를 에이전트에게 주는 도구(Aider의 repo map 등), 그리고 "압축한 지도를 `CLAUDE.md`/`AGENTS.md`에 상시 넣는 편이 필요할 때 불러오는 스킬보다 낫다"는 사례 보고가 있다(웹 검색 결과 요약이며 원문은 확인하지 못했다). 그래서 **우리 구조에 맞는 지도를 직접 만들고, 정합성은 CI가 보장**하는 방식을 제안한다. 스킬은 그 지도를 쓰도록 안내하는 보조 수단이지 강제 수단이 아니다.

### 5.1 형식 (기능마다 `feature.map.yaml`, 사람이 의도를 쓰고 기계가 사실을 채운다)
```yaml
id: notification
summary: 결재 이벤트를 인앱·텔레그램 알림으로 바꾸고 운영 알림을 보낸다
keywords: [알림, 벨, 읽음, 텔레그램, 연결, 수신 방식, 웹훅, 폴링]   # 한국어 동의어 포함 — 질의 매칭용
access:                                   # 사용자가 이 기능에 닿는 길
  - { who: 모든 구성원, path: "헤더 알림 벨 → /notifications", entry: ui/pages/notifications }
  - { who: 모든 구성원, path: "사용자 메뉴 → 내 정보 → 알림 탭", entry: ui/components/telegram-section }
  - { who: 시스템 관리자, path: "사용자 메뉴 → 텔레그램 수신 방식 → /system/telegram", entry: ui/pages/system-telegram }
screens:
  - route: /notifications
    file: src/ui/pages/notifications.tsx
    dom:                                  # 화면 위치와 식별자 (CI가 코드에서 존재를 확인)
      - { role: button, name: "모두 읽음", where: "페이지 우상단 도구줄" }
      - { role: link, name: "알림", where: "앱 헤더 우측 벨", testid: null }
api: { generated: true }                  # 라우트·핸들러는 코드(OpenAPI)에서 채운다
tables:                                   # owns 는 스키마의 @owner 주석에서 채우고, reads 는 사람이 선언한다 (3.4)
  owns: { generated: true }
  reads: []
events: { publishes: [], consumes: [approval_event] }
contracts: [approval-events]              # 사용하는 shared/contracts
jobs: [notify.telegram]
tests: { unit: src/domain, int: tests/*.int.test.ts, e2e: tests/e2e/notification.spec.ts }
invariants: ["외부 채널 문구에 문서 제목·내용 없음", "연결 토큰은 해시만 저장·1회용"]
```
- `generated: true` 항목(`owns` 포함)은 `pnpm feature:index`가 채우고 사람은 손대지 않는다. 사람이 쓰는 것은 `summary`, `keywords`, `access`, `dom.where` 같은 **의도**뿐이다.
- 모든 사용자 노출 요소는 `role + 접근 가능한 이름`을 우선 식별자로 쓴다(이미 E2E가 쓰는 방식). 필요할 때만 `data-testid`.

### 5.2 흐름
1. **색인:** `pnpm feature:index` → `docs/feature-map/index.json`(전체 지도, 기계용) + `docs/feature-map/INDEX.md`(압축본). 압축본(기능당 5~8줄: 기능, 키워드, 진입 화면, 폴더)은 `CLAUDE.md`에서 가져오도록 해 **항상 컨텍스트에 있게** 한다.
2. **질의:** 에이전트는 코드를 훑기 전에 `pnpm feature:find "알림 읽음 버튼"`을 실행한다 → 기능 id, 파일, DOM 위치, 접근 경로, 관련 테스트를 한 번에 받는다. 프로젝트 스킬 `feature-map`이 이 절차를 지시한다.
3. **정합성(L5):** CI의 `feature-map check`가 ① 지도에 적힌 파일·`role/name`·라우트가 실제로 있는지 ② 코드에 있는 라우트·페이지·테이블이 지도에 빠지지 않았는지 ③ 인덱스가 소스와 같은지(최신 아님 → 실패)를 확인한다. 지도를 갱신하지 않은 변경은 병합되지 않는다.
4. **변경 영향:** `feature:impact <파일>`이 변경 파일이 속한 기능과 그 기능을 쓰는 합성 루트를 알려 준다 → 평가 에이전트가 검사할 범위를 좁히는 데도 쓴다.

기존 [docs/INDEX.md 9장 "코드 위치"](../INDEX.md)는 수작업 지도라 쉽게 낡는다. 이전이 끝나면 이 절을 생성된 지도로 대체한다.

## 6. 리팩토링 단계
모든 단계의 **공통 완료 조건**: 린트·타입·단위·통합(연속 2회)·E2E·`next build` 통과, 기준선 감소(증가 금지), 한 단계 = 논리 단위별 커밋. 동작은 바꾸지 않는다(기존 테스트 단위 327·통합 418·E2E 53이 안전망이다). 이동은 `git mv`로 이력을 보존한다.

| 단계 | 내용 | 완료 기준 (측정 가능) | 크기 |
|---|---|---|---|
| P0 기준선 | 결합 측정 스크립트를 `tools/`로 정식화, 기능 배정표 확정, 현재 지표 기록(기능 간 import 수, 파일 수, 억제 주석 수) | 지표가 `docs/`에 기록됨. 이 문서의 1차 추정 대체 | S |
| P1 도구 골격 | (도구 4종은 설치 완료 — 8장) dependency-cruiser·Knip·Biome 오버라이드 생성기 설정, **기준선 래칫으로 CI 연결**, `quality-report.json` 뼈대, CODEOWNERS | CI에서 새 위반이 실패함을 일부러 만든 위반으로 확인. 기준선 = 현재 위반 수 | M |
| P2 공통 영역 1차 | 이미 공유 성격인 것 이동: `http`·`problem`·`env`·`deps`·`audit(recordAudit)`·`storage`·`ui/*`·`authz(can)`·`testing`을 `@fmerp/shared`로, `packages/db`는 그대로 공통 영역으로 취급 | `shared` 이외의 어디에도 이 코드의 사본이 없음. 위반 약 30% 감소 예상 | M |
| P3 시범: `notification` | 기능 패키지 구조 확립: 폴더 이동, Next 어댑터, 합성 루트 등록, `feature.map.yaml`, 테스트 이동. **구조의 템플릿을 여기서 확정** | `notification`의 위반 0건, 기능 격리 검사 통과, 지도 검증 통과 | M |
| P4 작은 기능 | `audit` → `home` → `backup` → `completion` 순. 기능 간 import는 공통 승격·계약+주입·이벤트로 해소 | 각 기능 위반 0건, 격리 검사 통과 | M×4 |
| P5 인증·조직 | `account` → `org`. `shared/authz`(역할·권한·세션 컨텍스트)를 먼저 확정해 둘의 상호 import 제거 | 두 기능 위반 0건 | M×2 |
| P6 `approval` | 가장 큰 덩어리. 내부 `engine/forms/mailbox` 폴더로 나누고, `completion`·`audit`·`notification`이 읽는 문서 구조를 `shared/contracts`로 노출 | `approval` 위반 0건, 전체 기준선 0 | L |
| P7 테이블 소유권 | 스키마는 그대로 두고 모든 테이블에 `@owner` 주석, 소유권 검사(3.4)와 `tables.reads` 선언, 마이그레이션 `-- feature:` 태그 규칙 | 소유권 위반 0건, `drizzle-kit generate`가 변경 없음을 보고(스키마 동일) | M |
| P8 지도·스킬 | `feature-map` 도구, `feature:find/index/check/impact`, 스킬, `CLAUDE.md` 압축본 삽입, INDEX 9장 대체 | 지도 검사 CI 통과, 이전 지도와 INDEX 9장 내용 일치 확인 | M |
| P9 공용 코드 사후 정리 | 7장 절차: 중복·재사용 탐지로 공통 후보를 분류해 `shared`로 승격, 단독 사용 모듈은 역승격 | 7장 기준 충족, 격리 검사 전 기능 통과 | M |
| P10 하드 전환 | 기준선 파일 삭제, 모든 규칙 `error` 고정, 억제 주석 상한 고정, 규칙 파일 보호 활성화 | 위반 0건, `guard`가 규칙 약화 PR을 막는지 시험으로 확인 | S |

- **순서의 이유:** 도구와 래칫을 먼저(P1) 깔아 이전 도중에도 후퇴하지 않게 하고, 공통 영역(P2)을 먼저 비워 기능 이동 때 해소할 결합을 줄인 뒤, 영향이 작은 기능으로 템플릿을 굳히고(P3~P5) 가장 큰 `approval`을 마지막에 옮긴다.
- **M9(소셜 로그인)와의 관계:** M9는 `account`를 크게 만진다. **M9 이전에 P0~P5를 끝내는 것을 권한다**(Q8). 그렇지 않으면 M9 코드를 옛 구조에 쓰고 곧 다시 옮기게 된다.
- **롤백:** 단계마다 커밋이 나뉘어 있어 한 단계씩 되돌릴 수 있다. 실행 중 동작이 달라지면(테스트 실패) 그 단계에서 멈추고 원인을 `docs/ts/`에 남긴다.

## 7. 공용 코드 분류와 공통 영역
### 7.1 승격 기준 (사후 정리 P9의 규칙)
| 상황 | 결정 |
|---|---|
| 둘 이상의 기능이 **같은 이유로** 쓴다 (규칙·계약·인프라) | `shared`로 승격 |
| 겉모양만 같고 **바뀌는 이유가 다르다** (닮았지만 기능마다 달라질 코드) | 승격하지 않고 기능별로 둔다 (중복 허용) |
| 한 기능만 쓴다 | 기능 안에 둔다. `shared`에 있다면 **역승격** (arch-check 경고) |
| 기능 간 호출이 필요하다 | 3.2의 계약+주입 또는 이벤트 — 승격이 아니라 연결 |

### 7.2 탐지 도구
- **사용처 수:** dependency-cruiser로 `shared` 모듈별 사용 기능 수를 집계한다(1개면 역승격 후보).
- **중복 코드:** `jscpd`로 기능 사이 복제된 블록을 찾는다(임계값은 P9에서 정한다). 사람이 7.1 표로 분류한다.
- **현재 확인된 공통 후보(초안):** `recordAudit`·`computeAuditDiff`, `can()`·`loadActor`(권한 판정), `ServiceContext`/`ApprovalError` 류 공통 오류·컨텍스트, `withTenant`, `problem+json`, `requireSession/Tenant` 미들웨어, `api.ts`·`queries.ts`의 기반 부분, shadcn `ui/*`, `ObjectStorage`, 시험 도우미(`test-client`).
- 최종 `shared`는 3.1의 트리처럼 `db/ authz/ http/ audit/ storage/ env/ ui/ contracts/ testing/`로 구성한다.

### 7.3 "자기 폴더 + 공통 영역만으로 개발 가능" 검증 — 기능 격리 검사
기능마다 CI에서 **그 기능과 `shared`만 남긴 상태**로 확인한다: (1) 해당 기능 패키지의 `tsc --noEmit`, (2) 단위·통합 테스트. 구현은 기능별 `tsconfig.isolated.json`(`include`가 기능+shared뿐)과 `pnpm --filter @fmerp/feature-x...` 필터이며, 다른 기능이 없어도 통과해야 한다. 이것이 원칙 R2("짧은 경로")의 기계적 증명이다.

## 8. 필요한 도구 (승인됨, 설치 완료)
[rules/dependencies.md](../rules/dependencies.md) 2장 기준(최근 12개월 배포, 허용 라이선스, peer)으로 2026-10-06에 `npm view`로 확인한 값이다. **TypeScript 6.0과의 호환은 설치 시점에 확인한다(미검증).**

| 도구 | 용도 | 종류 | 버전 | 라이선스 | 마지막 갱신 | 비고 |
|---|---|---|---|---|---|---|
| dependency-cruiser | L2 해석된 경로 기준 경계·순환·순수성 검사, 기준선 | devDependency (루트) | 18.5.0 | MIT | 2026-09-30 | **필수** |
| Knip | L3 미사용 파일·export·의존성 | devDependency (루트) | 6.39.0 | ISC (허용 목록) | 2026-09-30 | **필수** |
| @vitest/coverage-v8 | L7 기능별 커버리지 하한 | devDependency | **~4.1.11** (Vitest와 같은 버전. 최신 5.x는 맞지 않음) | MIT | 4.1.11 확인 | **필수** |
| jscpd | 7.2 중복 코드 탐지 (P9) | devDependency | 5.4.0 | MIT | 2026-09-30 | P9에서 설치 |
| @stryker-mutator/core (+vitest-runner) | L7 변이 테스트 (`domain/`, 야간) | devDependency | 10.0.0 | Apache-2.0 | 2026-08-14 | **선택**, Vitest 4.1 지원 여부 미확인 → 보류 가능 (Q4) |
| Biome | L1 (기존 ~2.5.15) — 설정만 확장 | 기존 | – | – | – | `noRestrictedImports.patterns`(2.2+), `noPrivateImports`, GritQL 플러그인 사용 |
| lefthook, Vitest, Playwright | 기존 | 기존 | – | – | – | pre-push에 `pnpm verify` 추가 |
| `tools/arch-check`, `tools/feature-map`, `tools/guard` | L4·L5·L6, 지도 생성·질의 | 자체 작성 (`tsx` 실행, 외부 의존성 없음) | – | – | – | 프로젝트 안에서 유지 |
| 프로젝트 스킬 `feature-map` | 지도 사용 절차 안내 | 스킬 | – | – | – | 보조 수단 |
| GitHub CODEOWNERS / 브랜치 보호 | L6 규칙 파일 변경 승인 | 설정 | – | – | – | 저장소 설정은 사람이 한다 |

**설치 결과(2026-10-06, 루트 `devDependencies`, `~` 범위로 고정):** dependency-cruiser ~18.5.0, knip ~6.39.0, jscpd ~5.4.0, @vitest/coverage-v8 ~4.1.11. `strictPeerDependencies`로 peer 충돌 없이 설치됐다. Stryker는 결정 Q4에 따라 P6 이후로 미룬다(설치하지 않음).

**스모크 검증 (TypeScript 6.0.3):**
| 도구 | 결과 | 메모 |
|---|---|---|
| dependency-cruiser | 동작. `apps/web`·`packages` 일부 214모듈·1,090의존을 분석 | ① `tsConfig`에 `apps/web/tsconfig.json`을 주면 `extends: ../../tsconfig.base.json`을 잘못 읽어 실패한다 → **루트에 `@/*` 별칭을 담은 전용 tsconfig**(`extends: ./tsconfig.base.json`)를 두고 쓴다(P1). ② 시험 중 **실제 순환 의존 1건**을 이미 찾았다(`apps/web/server/deps.ts` ↔ `http.ts`; 타입 import 순환일 가능성이 커서 P1에서 `type-only`를 구분한다) |
| Knip | 동작(설정 없이도). 미사용 파일 3, 미사용 의존성 2, 미사용 export 20, 미사용 타입 8을 보고 | 첫 결과가 곧 P0 기준선 후보. Next 진입점·shadcn 컴포넌트(`components/ui`)의 미사용 export는 오탐이라 설정으로 제외한다. 새로 설치한 `dependency-cruiser`·`jscpd`는 아직 설정 파일이 없어 "미사용"으로 보인다(P1에서 해소) |
| jscpd | 버전 확인만(`5.4.0`). 본 실행은 P9 | |
| @vitest/coverage-v8 | 설치만. 기능별 하한은 P1에서 설정 | Vitest ~4.1.11과 같은 버전 |

**검토 후 제외:** `eslint-plugin-boundaries`(7.2.0, MIT) — ESLint 도입이 필요해 Biome 단일 린터 방침과 충돌하고 dependency-cruiser가 같은 역할을 한다. Nx `enforce-module-boundaries` — Nx 도입이 과하다. Steiger/Feature-Sliced Design — 고정된 계층 규칙이 "평평한 기능 + 공통"이라는 요구와 맞지 않아 개념만 참고한다. `ts-arch` — `npm view`로 정보를 얻지 못해 판단 보류.

**승인 후 같이 바꿀 문서:** TECH_SPEC 4장(저장소 구조)·3장(도구 표), [rules/architecture.md](../rules/architecture.md)(의존 방향, 이 문서 3장으로 대체), INDEX(구조·지도), CLAUDE.md(압축 지도, 검증 명령 `pnpm verify`), 새 ADR(구조 결정).

## 9. 평가(eval) 단계와의 연결 (이 문서의 범위 밖, 설계 연결점만)
- **게이트가 평가의 바닥이다.** 평가 에이전트의 점수는 하드 게이트를 통과한 코드에만 의미가 있다. 게이트는 **에이전트 밖(CI)** 에서 실행하고, 평가 에이전트에게 린트·도구 설정 파일의 쓰기 권한을 주지 않는다(L6).
- **`quality-report.json`(초안 필드):** `commit`, `gates[{name, pass, durationMs, details}]`, `metrics{crossFeatureImports, suppressions, coverageByFeature, mutationScoreByFeature, unusedExports, featureMapStale, duplicatedLines}`, `changedFeatures[]`(`feature:impact`), `testCounts`. 점수 변환은 이 JSON을 입력으로 하는 별도 함수(`eval/score.ts`)와 사용자가 정하는 `eval/metrics.yaml`(지표→가중치→임계값)로 둔다.
- **반복 루프(개요):** 구현 에이전트 → `pnpm verify:all`(하드 게이트 실패 시 점수 계산 없이 실패 사유만 반환) → 평가 에이전트(지도로 변경 범위 파악 → 사용자 지표 기준 채점) → 임계 점수 미만이면 피드백과 함께 재작업. 루프 상한과 비용 제한, 평가 에이전트 자신의 편향 점검(고정 기준 샘플로 보정)은 별도 계획 문서에서 다룬다.
- 사용자가 제시할 "성과지표"는 가능한 한 **측정 가능한 값**(테스트 통과율, 커버리지, 변이 점수, 응답 시간, 번들 크기, 접근성 위반 수 등)으로 바꿔 `metrics`에 넣는다. 주관적 항목(가독성 등)은 평가 에이전트의 루브릭으로 분리한다.

## 10. 결정 사항(2026-10-06)과 위험
| # | 질문 | 결정 |
|---|---|---|
| Q1 | 물리 구조 | **기능별 pnpm 패키지(`features/*`)** — 제안대로 |
| Q2 | `approval` 분할 | **분할하지 않고** 결재의 하위 영역(엔진·양식·문서함)이 **한 스코프를 공유**한다 (3.3) |
| Q3 | ESLint 도입 | 도입하지 않는다. Biome + dependency-cruiser |
| Q4 | 변이 테스트 | P6 이후로 보류, Vitest 4.1 호환부터 확인 |
| Q5 | 기준선 | **래칫** — 현재 위반을 기준선으로 고정하고 단계마다 줄여 마지막에 0 |
| Q6 | 스키마 | **Drizzle 선언은 공통 영역에서 한 번에**(기능별 분할·SQL 외래 키 예외 없음). 데이터 수준 결합은 **테이블 소유권 검사**로 보완 (3.4) |
| Q7 | Next `app/` 어댑터 | 한 줄 어댑터 허용 |
| Q8 | M9와의 순서 | **M9 전에** P0~P5 |
| Q9 | 진행 방식 | 이전·리팩토링 계획을 완성하고 **단계별로 커밋하며 세션을 나눠** 진행한다 (12장) |

**위험:** ① Next 16 + 워크스페이스 패키지 조합의 빌드 시간·HMR 영향(P3 시범에서 측정) ② 스키마가 공통 영역에 있으므로 기능이 다른 기능의 테이블을 직접 다룰 위험 → 소유권 검사(3.4)가 막는다. 또 기능 격리 검사가 의존 공유 테스트 데이터(시드)에 막힐 수 있음 → `shared/testing`의 시드 도우미 승격 필요 ③ 계약+주입이 늘면 간접 호출이 많아져 "짧은 경로"가 길어질 수 있음 → 계약은 타입·포트만, 구현은 한 곳에 두고 지도에 기록 ④ 이 문서의 결합 수치는 추정 매핑 기준.

## 11. 결정·변경 기록
- 2026-10-06: 초안 작성. 코드·설정·의존성은 바꾸지 않았다. 결합 측정은 임시 스크립트로 했고(저장소에 넣지 않음) P0에서 `tools/`로 정식화한다.
- 2026-10-06: S5 완료(12장 기록): `features/audit`·`features/home` 이동, 기능 간 결합 4건 해소.
- 2026-10-06: S4 완료(12장 기록): `features/notification` 시범 이동, 기능 격리 검사(`pnpm feature:check`)·커버리지 하한 도입, 구조 템플릿 확정.
- 2026-10-06: S3 완료(12장 기록): 공통 영역 1차 이동, arch:move 도구, shared-to-feature 게이트.
- 2026-10-06: S2 완료(12장 기록): 도구 골격·래칫 기준선·CI 연결·ADR 0012. 이 문서 2장의 임시 수치는 정식 측정으로 대체되었다.
- 2026-10-06: Q1~Q9 결정 반영. Q6은 제안(SQL 외래 키)과 달리 "스키마를 공통 영역에 한 번에 선언"으로 정해졌고, 그 대가로 테이블 소유권 검사(3.4)를 추가했다. 도구 4종(dependency-cruiser, knip, jscpd, @vitest/coverage-v8) 설치와 스모크 검증을 마쳤다(8장).

## 12. 세션 진행 계획
한 세션에서는 **완결된 단계만** 끝낸다. 기능 이동이 반쯤 된 채로 세션을 끝내지 않는다(끝내지 못하면 마지막 정상 커밋으로 되돌리고 원인을 기록한다).

| 세션 | 범위 | 끝나는 조건 | 상태 |
|---|---|---|---|
| S1 | 계획 확정, 도구 설치·스모크 | 문서·도구 커밋 | **완료 (2026-10-06)** |
| S2 | P0 기준선 + P1 도구 골격 (+ ADR 0012 작성) | 래칫 기준선으로 CI 연결, 의도적 위반이 CI에서 실패함을 확인, `quality-report.json` 뼈대 | **완료 (2026-10-06)** |
| S3 | P2 공통 영역 1차 (+ `features/*`·`shared` 워크스페이스 골격) | 공통 코드 사본 0, 기준선 감소 | **완료 (2026-10-06)** |
| S4 | P3 시범 `notification` | 구조 템플릿 확정, 격리 검사 통과, 빌드 시간·HMR 영향 측정 기록 | **완료 (2026-10-06)** |
| S5 | P4 `audit`·`home` | 두 기능 위반 0건 | **완료 (2026-10-06)** |
| S6 | P4 `backup`·`completion` (계약+주입 첫 적용) | 두 기능 위반 0건 | 대기 |
| S7 | P5 `account`·`org` (`shared/authz` 확정) | **M9 착수 전 완료 목표** | 대기 |
| S8–S9 | P6 `approval` (가장 큼, 두 세션까지 허용) | `approval` 위반 0건, 전체 기준선 0 | 대기 |
| S10 | P7 테이블 소유권 + P8 feature map·스킬 | 소유권·지도 검사 CI 통과 | 대기 |
| S11 | P9 공용 코드 사후 정리 + P10 하드 전환 + 문서 정리(TECH_SPEC 4장·rules/architecture.md·INDEX·CLAUDE.md) | 기준선 파일 삭제, 위반 0, 규칙 우회 방지 확인 | 대기 |

**모든 세션의 공통 규칙**
1. 시작: 이 12장의 "다음 세션 시작 지침"을 읽고, `git status`가 깨끗한지, `pnpm verify`(P1 이후) 또는 린트·타입·단위가 통과하는지 먼저 확인한다.
2. 진행: 논리 단위마다 커밋한다. 파일 이동은 `git mv`로 하고 이동과 수정을 **별도 커밋**으로 나눈다(이력 추적).
3. 종료: ① 공통 완료 조건(6장)을 모두 통과 ② 진행 기록(11장)에 지표(기준선 위반 수, 파일 수, 억제 주석 수)와 결정·발견을 추가 ③ 아래 "다음 세션 시작 지침"을 갱신 ④ 세션 표의 상태를 갱신하고 커밋.
4. 어떤 세션도 규칙을 약화하지 않는다(기준선 증가, 억제 주석 추가, 규칙 파일 완화 금지). 필요하면 사용자에게 묻는다.

**S2 진행 기록 (2026-10-06)**
- **만든 것:** `tools/`(워크스페이스 `@fmerp/tools`): 기능 배정표(`feature-assignment.ts`), 래칫 게이트 5종(`unassigned-files`·`cross-feature`·`depcruise`·`knip`·`suppressions`), `arch-check`·`guard`·`run-gate`·`quality-report`·`boundaries` CLI, 시험 3벌(`tools/src/__tests__`: 래칫 평가, 배정표, dependency-cruiser 규칙 임시 저장소 시험, Biome 경계 생성 시험). 설정: `.dependency-cruiser.cjs`, `tsconfig.depcruise.json`, `knip.json`, `biome.boundaries.json`(생성), `.github/CODEOWNERS`, CI(정적 게이트를 앞에 두고 `artifacts/quality-report.json` 항상 생성), lefthook pre-push, 루트 스크립트 `arch:check`·`arch:baseline`·`arch:guard`·`arch:boundaries`·`quality:report`·`verify`·`verify:all`.
- **P0 기준선 (래칫에 고정한 값):**

| 게이트 | 건수(=한도) | 내용 |
|---|---|---|
| `cross-feature` | **48** | 기능 사이 import 파일 쌍. 큰 순: 완료→결재 9, 백업→결재 5, 감사→결재 5, 결재→완료 4, 계정→조직 4, 백업→계정 4, 알림→백업 3, 나머지 1~2 |
| `depcruise` | **1** | 값 순환 1건: `packages/db/src/schema/auth.ts` ↔ `tenant.ts` (타입 전용 순환은 제외) |
| `knip` | **34** | 미사용 파일 1, 미사용 의존성 2, 미사용 export 15, 미사용 타입 10 등. 첫 측정(40)에서 shadcn `components/ui`·Next 진입점 오탐을 설정으로 제외하고, 내 도구의 미사용 export를 고쳐 6건을 줄였다 |
| `suppressions` | **10** | `biome-ignore` 10건(파일 10개) |
| `unassigned-files` | **0** | 배정표에 규칙이 없는 소스 파일. 새 파일이 생기면 실패 |

- **검증:** 위반 주입 시험 — 다른 기능을 import하는 새 파일에 `@ts-ignore`를 넣었더니 `cross-feature`(새 위반 1·한도 초과)·`knip`(미사용 파일)·`suppressions`가 모두 실패했다(파일은 되돌림). 한도를 올린 작업 트리는 `arch:guard`가 실패시켰다. `features/`·`shared/`·`apps`·`packages` 경계 규칙 7종과 값/타입 순환 구분은 임시 저장소 시험으로 확인했다. 린트(경고 6건 유지)·타입·단위 372건 통과(기존 327 + tools 45).
- **계획과 달라진 점·이월:** ① 기능별 **커버리지 하한**은 기능 폴더가 생긴 뒤에야 의미가 있어 S4(시범)로 넘겼다(도구는 설치됨). ② dependency-cruiser가 `apps/web/tsconfig.json`의 `extends`를 못 읽는 문제는 루트 전용 tsconfig로 우회했다(별칭을 두 곳에서 같게 유지해야 한다). ③ `pnpm` 명령을 PATH 없이 쓰는 환경(Windows)에서는 `run-gate`로 감싼 `pnpm …` 명령이 실패한다 — CI(Ubuntu)에서만 쓰는 래퍼다. ④ 부분 스키마 `@owner` 소유권 검사·`feature-map` 도구는 계획대로 P7·P8. ⑤ CI 변경(`.github/workflows/ci.yml`)은 이 PC에서 실행해 보지 못했다(문법과 로컬 명령만 확인) — 첫 push에서 확인한다.

**S3 진행 기록 (2026-10-06)**
- **만든 것:** `shared/` 워크스페이스(`@fmerp/shared`, `exports`: `./ui/*`→`src/ui/*.tsx`, `./*`→`src/*.ts`)와 `features/*` 워크스페이스 패턴. **이동 도구 `pnpm arch:move`**(`--map 옛=새`, `--dir-map`, `--dry`): 이동 전 위치로 모든 import를 해석해 두고 `git mv` 뒤 새 위치 기준으로 지정자를 다시 쓴다(상대·`@/` 별칭·`@fmerp/shared/*`, 동적 import, `vi.mock`, `import()` 타입 처리, 공통→apps import는 경고). 시험 5건.
- **옮긴 것 (동작 변경 없음):** `shared/src/server/{http,problem,env,common,service-context,context(←approval/context),errors(←approval/errors),deps(타입)}`, `shared/src/authz/org-access`, `shared/src/ui/*`(shadcn 15개), `shared/src/lib/{api,utils}`. 실제 연결을 만드는 `getServerDeps`는 합성 루트(`apps/web/server/deps.ts`)에 남겼다. UI 의존성(radix-ui·cva·cn·next-themes)은 apps/web에서 shared로 옮겼고 Tailwind `@source`·Next `transpilePackages`·vitest include·`components.json` 별칭을 맞췄다. `packages/db·audit·storage`는 제자리에 두고 공통 영역으로 취급한다.
- **지표 변화:** 기능 간 import 48→**43**(결재 context/errors를 공통으로 올려 감사·완료→결재 5건 해소), 순환 1, Knip 34(이름 변경만), 억제 주석 10(경로만 변경), 미배정 0. **새 게이트 `shared-to-feature` = 7** — 공통 영역이 기능 코드를 import하는 경계 부채를 따로 센다(배럴은 이름 단위로 풀어 센다): `http.ts`→`@fmerp/auth` 세션 처리 3(`accounts`·`errors`·`session-guard`), `deps.ts`→`auth` 타입 1, `errors.ts`→결재 엔진 오류 코드 2(`ApprovalErrorCode`가 `EngineErrorCode`를 포함), `lib/types.ts`→`form-schema` 1. 해소 방향: 세션·멤버십 기본기는 S7의 `shared/authz`로, 오류는 일반 `ServiceError` + 결재 전용 코드 분리(S8~9), `lib/types.ts`는 기능별로 쪼개 이동.
- **검증:** 린트(경고 6)·타입(`shared` 포함)·단위 377·`next build`·통합 418 연속 2회·E2E 53(3 건너뜀) 통과, 개발 서버로 홈 화면 확인(스타일 유지), Tailwind가 shared의 클래스를 만드는 것 확인. 위반 한도는 늘지 않았다(`arch:guard`).
- **발견·이월:** ① `ApprovalError`·`ServiceContext`라는 이름이 결재 특화라 공통 영역에 있는 것이 어색하다 → 이름 일반화(`ServiceError`, `ServiceContext`)는 결재 이전(S8~9)에서 한꺼번에. ② `apps/web/lib/queries.ts`·`types.ts`는 기능별 훅·타입이 섞여 있어 아직 `shared`로 분류만 되어 있다 — 기능을 옮길 때 각 기능으로 쪼갠다(`shared-to-feature` 1건). ③ 커밋 scope에 `shared`를 추가했다(commitlint·git.md). ④ 이 PC에서 `pnpm install --offline`은 공급망 정책 검사 때문에 실패하므로 온라인 설치를 쓴다.

**S4 진행 기록 (2026-10-06) — 구조 템플릿 확정**
- **기능 폴더 템플릿 (`features/notification/`, 이후 7개 기능이 따른다):**
  - `package.json`(`@fmerp/feature-<이름>`; `exports`로 **진입점만** 공개: `./api/routes`, `./jobs/jobs`, `./ui/pages/*`, `./ui/components/*`, `./ui/queries`), `tsconfig.json`(include `src`·`tests`), `feature.map.yaml`(초안, P8에서 검사).
  - `src/domain`(순수 규칙) · `src/service`(업무 로직·DB) · `src/api/routes.ts`(`register…Routes(app, deps, 주입 계약)`) · `src/jobs/jobs.ts`(`register…Jobs(boss, deps)`) · `src/ui/{pages,components,queries.ts}`. 배럴(`index.ts`)은 두지 않는다.
  - `tests/`: 단위 `*.test.ts`, 통합 `*.int.test.ts`, 시험 도우미 `test-support.ts`(이 이름이라야 "시험 파일"로 인식된다). vitest 포함 패턴에 `features/*/{src,tests}/**`를 추가했다.
  - Next `app/`의 `page.tsx`는 `export { default } from "@fmerp/feature-x/ui/pages/…"` 한 줄 어댑터이고 배정표에서 **합성 루트**로 분류한다. Tailwind는 `globals.css`의 `@source "../../../features"`가 기능 폴더의 클래스를 만든다.
- **기능 간 결합을 푼 방법 (7건 + 공통 승격 3건, 모두 동작 변경 없음):**
  1. **계약 + 주입(함수)**: 운영 알림이 쓰던 감사·백업 판정(`reviewStatuses`·`backupHealth`·`isSystemAdmin`)을 `shared/src/contracts/ops-alerts.ts`의 `OpsAlertRules`로 선언하고, worker 합성 루트(`main.ts`)가 실제 함수를 주입한다. 시험은 `tests/test-support.ts`의 `testOpsRules`(대역)를 쓴다 — 실제 판정은 감사·백업 기능의 단위 시험이 맡는다.
  2. **계약 + 주입(가드)**: 시스템 관리자 확인·PIN 재인증은 `shared/src/contracts/system-guards.ts`의 `SystemGuards`로 선언하고 `app.ts`가 백업 기능의 구현을 `registerNotificationRoutes(app, deps, guards)`에 넘긴다. 세션 타입은 `SessionInfo`(= `AppEnv` 세션)로 바꿔 `@fmerp/auth` import를 없앴다.
  3. **계약(타입, 공통 소유 파일)**: 결재 이벤트 형식 `ApprovalEvent`를 `packages/core/src/approval-event.ts`로 분리하고 배정표에서 `shared`로 분류했다(결재가 만들고 알림이 읽는다). 계획은 `shared/contracts`였지만 `shared`가 `core`에 의존하므로 `core → shared` 의존을 두면 pnpm 패키지 순환이 생긴다(`ERR_PNPM_TASK_CYCLE`; `ignoreWorkspaceCycles`로 풀지 않았다). `packages/core`가 해체될 때(P9~P10) `shared/contracts`로 옮긴다.
  4. **UI 슬롯 주입**: 내 정보 화면(계정)이 알림 탭을 직접 import하던 것을 `MePage`가 `notifySection` prop을 받게 하고, 합성 루트인 `me/page.tsx`가 `TelegramSection`을 끼운다.
  5. **공통 승격**: `PinDialog`·`useReauth`(결재·백업·알림 화면이 같은 이유로 쓴다) → `shared/src/ui/`; `formatDateTime` → `shared/src/lib/format.ts`; `test-client`(`loginAs`) → `shared/src/testing/`. `test-client`는 앱 전체를 import하던 것을 **앱 주입식**(`setTestApp`)으로 바꾸고, 합성 루트의 `apps/web/server/test-support.ts`가 vitest `setupFiles`로 주입한다 — 기능 시험이 `apps/`를 import하지 않는다.
  6. 알림 전용 UI 훅·타입(`useUnreadCount`·`useNotifications`·`useMyTelegram`·`useSystemTelegram`, `NotificationPage` 등)은 `apps/web/lib/{queries,types}.ts`에서 `src/ui/queries.ts`로 옮겼다(헤더 배지는 합성 루트 `app-shell`이 `@fmerp/feature-notification/ui/queries`를 import).
- **새로 만든 검사:** `pnpm feature:check <기능> [--skip-tests]` — ① 기능 tsconfig로 타입 검사하고 `tsc --listFiles` 컴파일 범위에 다른 기능·`apps/`·`tools/`가 없는지 확인(격리의 기계적 증명), ② dependency-cruiser 위반 중 그 기능에 걸린 것 0건, ③ 그 기능의 단위·통합 테스트만 돌려 커버리지가 `tools/baselines/coverage.json` 하한 이상인지 확인. `arch:guard`는 이 하한도 기준 커밋보다 낮출 수 없게 한다. 위반 주입 시험(기능 파일에서 `apps/` import)에서 ①·②가 모두 실패함을 확인하고 되돌렸다. 단위 시험 7건 추가(`tools/src/__tests__/feature-check.test.ts`).
- **측정:** `notification` 커버리지(줄 78.82 · 구문 75.86 · 함수 69.32 · 분기 56.76 %) → 하한 78·75·69·56. `next build` 61.5초 → **55.3초**(컴파일 14.1→16.5초, 타입 검사 28.2→22.3초, 측정 노이즈 범위 — 악화 없음). HMR: 기능 폴더의 UI 파일 수정 → 개발 서버가 **245ms**에 재컴파일하고 열린 화면에 반영됨(이동 전 수치는 측정하지 않았다).
- **지표 변화:** 기능 간 import 43→**33**(알림이 시작·도착인 결합 7건 + PIN 대화상자·훅 3건 해소), `shared-to-feature` 7(변화 없음), 순환 1, Knip 34→**26**(옛 배럴 export가 이름 단위로 드러난 것은 `export`를 없애 고침), 억제 주석 10, 미배정 0. 단위 시험·통합 418(연속 실행은 `pnpm test:int` 1회 + 부분 재실행)·E2E는 아래 검증 참조.
- **발견·이월:** ① E2E(`m8.spec.ts`)는 `apps/web/e2e/`에 남겼다 — Playwright가 `apps/web`에만 설치되어 `features/*/tests`에서 `@playwright/test`를 찾지 못한다. 다른 기능을 옮기면서 Playwright 설정을 루트로 올리는 방안을 정한다(S5). ② `packages/db/src/notification.int.test.ts`(RLS 격리)는 DB 패키지에 두었다 — P7(테이블 소유권)에서 기능으로 옮긴다. ③ 기능 격리 검사의 컴파일 범위에는 `@fmerp/core`의 모든 파일이 들어온다(`core`의 `index.ts`가 다른 기능 규칙도 내보내기 때문). `packages/core`가 해체되면 더 엄격해진다. ④ `apps/web/server/test-support.ts`는 이름 때문에(`/test-support.`) 시험 파일로 분류되어 배정표·결합 측정에서 빠진다(의도). ⑤ Windows에서 Biome 자동 수정이 정규식의 `[\\/]`(역슬래시·슬래시)를 `[/]`로 바꾼 적이 있어(`tools/src/feature-check.ts`), 경로 판정은 `path.win32/posix.isAbsolute`로 바꿨다. ⑥ 이 PC에서 `pnpm install`은 새 워크스페이스를 만들 때마다 필요하다(`arch:move`도 먼저 설치를 요구한다).

**S5 진행 기록 (2026-10-06)**
- **옮긴 것:** `features/audit`(core `audit-review`·`audit-timeline` → `domain`, `server/audit/{logs,timeline}` → `service`, `routes/audit.ts` → `api/routes.ts`, `audit-trail.tsx`·감사 화면 3개 → `ui`, 감사 통합 시험 → `tests/audit.int.test.ts`), `features/home`(홈 화면 → `ui/pages/home.tsx`). 합성 루트가 `@fmerp/feature-audit/{api/routes,domain/audit-review,ui/…}`·`@fmerp/feature-home/ui/pages/home`만 import한다.
- **결합을 푼 방법 (S4의 6가지 중):** ① **공통 승격**: 목록 커서 `encodeCursor`/`decodeCursor`(문서함·감사 공용) → `shared/server/cursor`, 관리 메뉴 판정 `adminEntry` → `shared/lib/admin-nav` ② **계약+주입**: 문서 열람 확인 `requireView` → `shared/contracts/document-access`(`DocumentAccess`, `Viewer`)를 `app.ts`가 `registerAuditRoutes(app, deps, access)`에 주입 ③ **UI 슬롯 주입**: 결재 상세 화면(`ApprovalDetailPage`)이 `printButton`·`timeline` prop을 받고, 합성 루트 `approval/[id]/page.tsx`(서버 컴포넌트, `await params`)가 감사의 `PrintButton`·`DocumentTimeline`을 끼운다 ④ 감사 화면의 행위자 필터가 쓰던 `useMembers`는 감사의 `useAuditActors`(같은 API, 필요한 필드만)로 대체 — 구성원 화면 타입을 import하지 않는다.
- **홈과 `shared/lib/{queries,types}`:** 홈이 읽는 `useMine`·`usePending`·`useForms`는 결재 데이터다. `apps/web/lib/queries.ts`·`types.ts`를 `shared/src/lib/`로 **물리 이동**해 기능이 import할 수 있게 했다(`@tanstack/react-query`를 shared 의존성에 추가). 기능 전용 훅·타입(감사의 `useAuditLogs` 등과 라벨)은 `features/audit/src/ui/queries.ts`로 옮겼다. 나머지 기능(결재·조직·백업·계정)의 훅·타입은 각 기능을 옮길 때 같은 방식으로 쪼갠다. 홈→결재 데이터 의존은 부채로 `features/home/feature.map.yaml`에 적었고, 결재 이전(S8~9)에서 계약 훅으로 바꾼다.
- **검사·기준선:** `feature:check audit` 통과(커버리지 줄 48.82·구문 46.8·함수 34.02·분기 32.42% → 하한 48·46·34·32; UI는 E2E가 확인해 낮다). `feature:check home` 통과(테스트가 없으면 테스트 단계를 건너뛰도록 도구를 고침). 기능 간 import 33→**29**(홈→조직 1, 감사→결재 2 해소, 결재→감사는 경로가 바뀌어 다른 형태로 남지 않음; 결재 상세→완료 결합은 파일만 `approval-detail.tsx`로 바뀜), `shared-to-feature` 7, 순환 1, Knip 26, 억제 주석 10(경로만 변경), 미배정 0. 한도는 늘지 않았다(`arch:guard`).
- **검증:** 린트·타입·`arch:check`·`arch:guard`·단위(385)·통합 418·E2E(아래)·`next build`·개발 서버 화면 확인은 커밋 메시지·진행 결과 참조.
- **발견 — 통합 시험의 실행 순서 의존 (수정함):** `org.int.test.ts`의 "소유자 둘이 동시에 서로를 비활성화" 시험이 `owner-b`에게 활성 소속(시험용 회사)을 하나 더 남겼다. vitest가 직전 실행의 실패·소요 시간으로 파일 순서를 바꾸면 `approval-m5-transfer`(`owner-b`로 `/api/approval-admin/overdue` 호출)가 그 회사로 들어가 403이 났다(S4 때는 우연히 순서가 맞아 드러나지 않았다). 시험 끝에 그 회사의 모든 소속을 `left`로 돌려 놓게 고쳤다. 또한 통합 시험을 **겹쳐 돌리면**(백그라운드 실행이 끝나기 전에 다시 시작) 21건이 실패한다는 [기존 기록](../ts/2026-10-05-audit-view-race-and-concurrent-int-runs.md)을 이번에도 어겼다 — 한 번에 하나만 돌린다.
- **이월:** E2E 위치(S4 이월 ①)는 아직 `apps/web/e2e`(Playwright가 `apps/web`에만 있음). S6에서 `backup`·`completion`을 옮기며 결정한다.

**다음 세션 시작 지침 (S6)**
- 읽을 것: 이 문서 3.1~3.3·6장 P4, S4·S5 진행 기록(템플릿·해소 방법), `features/{notification,audit}/`, `tools/src/cli/feature-check.ts`, [통합 시험 동시 실행 기록](../ts/2026-10-05-audit-view-race-and-concurrent-int-runs.md). 시작 전 `git status` 깨끗(`.claude/launch.json` 제외), `pnpm verify`·단위 통과, `pnpm env:up`. **통합 시험은 전경에서 한 번에 하나만** 돌린다.
- 할 일(P4 `backup` → `completion`): 기준선에서 이 둘이 낀 결합은 `completion→approval` 6, `approval→completion` 4, `backup→account` 4, `backup→approval` 4, `backup→completion` 2, `completion→account` 1이다. 가장 큰 덩어리는 완료 패키지가 읽는 **결재 문서 스냅샷**(계약+주입: `shared/contracts`에 포트를 두고 결재가 구현 — 첫 적용이므로 형식을 신중히 정해 진행 기록에 남긴다)과 백업이 읽는 계정·결재 데이터다. ① `features/backup`·`features/completion` 폴더 템플릿 생성(`pnpm install`) ② `arch:move --dry`로 범위 확인 후 이동: backup(`packages/backup`, `core/backup*`·`doc-number-parse`, `worker/{backup-*,cli/}`, `server/{system/,account-export,routes/{system,exports}.ts}`, `components/backup`, `app/(app)/{system/backups,admin/backups}`), completion(`packages/completion`, `core/completion-package`, `worker/{package-jobs,render,fonts,health}`, `routes/package.ts`, `approval/{package-download,document-storage}`, `completion-files.tsx`) ③ `worker/main.ts`·`app.ts`의 주입(`SystemGuards`는 백업이 제공, `OpsAlertRules.backupHealth`는 백업 진입점에서)을 새 진입점으로 바꾼다 ④ 두 기능 `feature:check` 통과·하한 기록 ⑤ E2E 이전 방안 결정 ⑥ 기준선 갱신·커밋. 완료 기준: 두 기능 위반 0건.
- 주의: 동작은 바꾸지 않는다(통합 418·E2E 53). 규칙 약화 금지. 새 공통 코드는 `shared`로(`shared-to-feature` 증가 금지).

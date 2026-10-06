---
status: accepted
---

# 코드는 기능(feature) 단위 폴더로 나누고, 기능 간 import와 품질 저하는 규칙 문서가 아니라 정적 분석·CI 실패로 막는다

배경: 에이전트가 작업하는 코드가 사람이 읽는 규칙보다 **실패하는 검사**로 신뢰되어야 하고, 이후 제3의 에이전트가 점수화하는 평가 루프를 얹을 수 있어야 한다. 지금은 코드가 기술 계층(`apps/web/server`, `components`, `app`, `packages/*`)별로 흩어져 있어 한 기능을 고치려면 7~8곳을 읽어야 하고(알림 기준), 기능 간 import가 파일 쌍 48개(1차 측정)에 이른다. 자세한 계획·측정·단계는 [계획 문서](../plan/2026-10-06-feature-architecture-refactor.md).

- **구조(Q1):** `features/<기능>/`을 **기능마다 pnpm 패키지**(`@fmerp/feature-<이름>`)로 만들고, 기능이 참조할 수 있는 외부는 **공통 영역(`shared`, 기존 `packages/db`·`audit`·`storage` 포함)** 뿐이다. 합성 루트(`apps/web`의 `app/`·`server/app.ts`, `apps/worker/src/main.ts`)만 여러 기능을 import하며, 그것도 기능이 내보낸 진입점(`routes`, `jobs`, `ui/pages/*`)만 쓴다. 다른 기능을 `package.json`에 선언하지 않으면 컴파일에서 해석되지 않는 것이 첫 번째 방어선이다.
- **기능 간 협력:** 직접 import는 금지한다. ① 여러 기능이 같은 이유로 쓰면 공통 영역으로 승격, ② `shared/contracts`의 타입·포트 + 합성 루트에서 구현 주입, ③ 이미 있는 `approval_event` 같은 이벤트(DB 경유). 겉모양만 닮은 코드는 승격하지 않는다(중복 허용).
- **결재(Q2):** `approval`은 쪼개지 않는다. 엔진·양식·문서함·검색·수신 하위 영역이 **한 스코프를 공유**하고 내부 경계 검사는 두지 않는다(서로 34건 import하는 한 덩어리).
- **스키마(Q6):** Drizzle 스키마와 마이그레이션은 **공통 영역(`packages/db`)에 한 번에 선언**한다. 기능별 분할도, SQL로 빼는 외래 키 예외도 없다. 대신 스키마가 공통이면 어느 기능이든 다른 기능의 테이블을 읽고 쓸 수 있으므로, 모든 테이블에 `@owner` 주석을 달고 **쓰기는 소유 기능만, 읽기는 `feature.map.yaml`의 `tables.reads`에 선언한 것만** 허용하는 소유권 검사로 보완한다(P7에서 구현).
- **강제 체계(결정 Q3: ESLint 없음):** Biome(기존, 기능별 `noRestrictedImports` 규칙은 `features/*`에서 생성한 `biome.boundaries.json`) + **dependency-cruiser**(해석된 실제 경로 기준 경계·순환·도메인 순수성) + **Knip**(미사용 코드·의존성) + 자체 `tools/`(기능 배정표 기반 결합 측정, 억제 주석 계수, 한도 가드, 품질 리포트). 전부 `pnpm arch:check`·`arch:guard`로 CI와 pre-push에서 같은 명령으로 돈다.
- **이전 중 후퇴 방지(Q5 래칫):** 현재 위반을 `tools/baselines/*.txt`에 고정한다. **새 위반은 실패**, **위반이 줄었는데 기준선을 안 줄여도 실패**(남은 여유분이 새 위반을 숨기지 못하게), 위반 수는 `limits.json`의 **한도**를 넘을 수 없다. 한도를 올리는 것(규칙 약화)은 `arch:guard`가 기준 커밋과 비교해 막고, 기준선·규칙·CI·`tools/` 파일은 CODEOWNERS로 사람의 승인을 요구한다. 마지막 단계(P10)에서 기준선을 삭제해 위반 0을 강제한다.
- **새 파일 배정:** 이전이 끝날 때까지 `tools/src/feature-assignment.ts`가 현재 위치를 기능에 대응시키고, 배정되지 않은 새 소스 파일은 `unassigned-files` 게이트가 실패시킨다.
- **feature map(P8):** 기능마다 `feature.map.yaml`(의도는 사람이, 라우트·테이블·파일은 코드에서 생성), 생성 색인 + `feature:find`, CI 정합성 검사. 지도가 낡으면 실패한다. 스킬은 이 절차의 안내일 뿐 강제 수단이 아니다.
- **진행(Q9):** 한 세션에 완결된 단계만, 논리 단위로 커밋. M9 전에 `account`·`org`까지(Q8).

**알려진 한계와 후속:** ① 기능 이동 전에는 `features/`·`shared/` 규칙이 실제 코드에 걸리지 않아 임시 폴더 시험(`tools/src/__tests__`)이 그 규칙의 증거다. ② 기능 간 결합 측정은 경로 규칙(배정표)과 import 해석에 기대는 근사이며, 배럴은 이름 단위로 풀지만 `import *`·기본 export는 풀지 못한다. ③ 기능별 커버리지 하한과 변이 테스트(Stryker, 결정 Q4)는 기능 폴더가 생긴 뒤로 미뤘다. ④ CODEOWNERS는 저장소의 "Code Owners 승인 필수" 설정을 사람이 켜야 효력이 있다. ⑤ `APP_ENV=staging` 테스트 로그인 예외(ADR 없음, M8 보안 리뷰 FU-M8-1)와 마찬가지로 규칙 약화는 항상 사람의 결정이어야 한다.

**Considered Options:** 기능을 단일 패키지 안의 폴더로만 나눔(컴파일 단계 방어 없이 린트에만 의존), `eslint-plugin-boundaries`(ESLint 도입이 필요해 린터가 둘이 됨), Nx `enforce-module-boundaries`(Nx 도입이 과함), Feature-Sliced Design/Steiger(고정된 계층 규칙이 "평평한 기능 + 공통"과 맞지 않음), 기능별 Drizzle 스키마 분할(외래 키가 다른 기능의 테이블 정의를 import해야 해서 경계 예외가 생기거나 SQL 외래 키로 빼야 함), 처음부터 모든 규칙을 error로(이전 도중 위반 수천 건으로 CI 마비 — 래칫이 대안), 규칙을 문서·스킬로만 안내(에이전트 품질이 낮아지면 지켜지지 않음).

# 아키텍처 규칙

기준: [TECH_SPEC 4장](../TECH_SPEC.md) · [DEPLOYMENT_PLAN 3·6장](../DEPLOYMENT_PLAN.md)

## 1. 저장소와 의존 방향
```
apps/web (Next 16 + Hono /api) ─┐   합성 루트: 기능의 진입점만 import
apps/worker (pg-boss 작업)      ─┤
                                 ├─> features/<기능> ─> shared ─> packages/{db,audit,storage}
                                 └─> shared               (기능끼리 import 금지)
```
- **기능(`features/<이름>`):** `src/domain`(순수 규칙) · `service`(업무 로직·DB) · `api`(Hono 라우트, 진입점 `routes.ts`) · `jobs`(worker 작업, 진입점 `jobs.ts`) · `ui`(화면). 밖으로는 `package.json`의 `exports`에 적은 **진입점만** 내보낸다. 배럴(`index.ts`)은 두지 않는다.
- **합성 루트:** `apps/web`의 `app/`(한 줄 어댑터: `export { default } from "@fmerp/feature-x/ui/pages/y"`)·`server/app.ts`·`apps/worker/src/main.ts`만 여러 기능을 import한다. 다른 기능의 것을 끼워야 하면 **슬롯(prop)·주입(함수·계약)**으로 합성 루트가 연결한다.
- **공통(`shared`):** `authz`(세션·구성원·재인증), `server`(http·오류·환경), `contracts`(기능 사이 계약 타입·포트), `domain`(여러 기능이 같은 이유로 쓰는 **순수** 규칙), `lib`, `ui`(shadcn), `testing`. 기능이 있는 것을 `shared`로 올리는 기준은 계획 7.1: 둘 이상이 같은 이유로 쓰면 승격, 한 기능만 쓰면 그 기능에 둔다, 겉모양만 같고 바뀌는 이유가 다르면 중복을 허용한다.
- **`shared/domain`·기능의 `domain/`:** **순수 TypeScript**. DB, HTTP, 파일, 현재 시각, 난수를 직접 쓰지 않는다. 시각·ID는 인자로 주입받는다.
- 결재 엔진(`features/approval/src/domain/approval-engine.ts`)은 `(문서, 행위, 행위자, 컨텍스트) → (새 문서, 이벤트, 처리 기록)`만 계산한다. 저장은 `features/approval/src/service/`가 문서 행을 잠근 뒤 한 트랜잭션에서 한다 (ADR 0007).
- `packages/db`: Drizzle 스키마 전체(**모든 표에 `@owner`**), 마이그레이션(권한·RLS 포함, 새 파일은 첫 줄 `-- feature: <이름>`), `withTenant`. `packages/audit`: 감사 로그는 `recordAudit`로만 쓴다. `packages/storage`: **S3 SDK는 이 패키지 밖에서 import하지 않는다.**
- 역방향 import와 apps 간 import는 금지한다. 위 규칙은 `pnpm arch:check`(dependency-cruiser·Knip·결합·표 소유권·기능 지도)가 **위반 0건**으로 강제한다(엄격 게이트, 기준선 없음). 예외는 `suppressions`의 이유가 적힌 허용 목록뿐이고 늘리려면 사람의 승인이 필요하다.

## 2. 실행 단위
| 단위 | 하는 일 | 하지 않는 일 |
|---|---|---|
| `apps/web` | 화면, API, 인증, 서명 URL 발급, 작업 큐 등록 | PDF 생성, 내보내기 ZIP, DB 덤프 같은 장시간 작업 |
| `apps/worker` | PDF·완료 패키지 생성, 내보내기, 일일·수동 DB 덤프, 알림 발송, 예약 작업 | HTTP API 제공 (헬스체크만) |

## 3. 공통 처리
- **환경 변수:** 앱마다 하나의 `env` 모듈에서 Zod로 검증해 읽는다. 그 밖의 곳에서 `process.env`에 직접 접근하지 않는다.
- **시간:** DB에는 UTC(`timestamptz`)로 저장하고, 화면에는 Asia/Seoul로 표시한다 (PRD NFR-U05).
- **금액:** 원 단위 정수만 쓴다. 부동소수점 계산은 금지한다.
- **결재 상태 전이:** 반드시 `features/approval/src/domain`의 함수를 거친다. API나 worker에서 상태 값을 직접 바꾸지 않는다 (PRD 5.4.1).

## 4. 미정 항목 (프로젝트 골격 생성 시 ADR로 확정)
- 기본 키 타입 (UUID v7 / bigint identity)
- DB의 금액 컬럼 타입과 앱 내부 표현
- API 에러 응답 형식
- 통합 테스트용 PostgreSQL 실행 방식

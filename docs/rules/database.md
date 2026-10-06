# 데이터베이스 규칙

기준: [PRD 7장 데이터 모델](../PRD.md) · [TECH_SPEC 3장](../TECH_SPEC.md)
스킬: **`supabase-postgres-best-practices`** — 스키마·마이그레이션·RLS·인덱스·쿼리를 다루기 전에 반드시 로드

## 1. 스키마
- 테이블과 컬럼 이름은 영문 소문자 snake_case를 쓴다.
- 기본 키는 `primaryId()`(uuidv7, ADR 0001), 생성·수정 시각은 `createdAt()`·`updatedAt()`을 쓴다 (`packages/db/src/schema/columns.ts`).
- 테넌트 데이터 테이블은 `account_id NOT NULL`을 갖고 **RLS 정책**을 적용한다. 정책 형식은 마이그레이션 0002를 따른다: `TO fmerp_app USING (account_id = app_current_account()) WITH CHECK (같음)`.
- 테넌트 데이터는 반드시 `withTenant(appDb, accountId, tx => …)` 안에서 조회·변경한다. 테넌트를 지정하지 않으면 RLS 때문에 0행이 나온다(안전한 기본값).
- 새 테넌트 테이블을 만들면 **테넌트 격리 테스트**(다른 계정 데이터가 조회되지 않음, 다른 계정으로 쓰기 거부)를 함께 작성한다.
- **모든 테이블 선언에 `@owner <기능|shared>` 주석을 단다**(스키마 파일의 JSDoc). 기능 코드는 자기 소유 표와 `shared` 표에만 쓰고, 다른 기능의 표를 읽으려면 그 기능의 `feature.map.yaml` `tables.reads`에 선언한다(정말 필요한 쓰기 예외는 `tables.writes`에 이유와 함께 선언). `pnpm arch:check`의 `table-ownership` 게이트가 `schema.<표>` 접근을 AST로 검사한다(한도 0). 원시 SQL 문자열은 검사하지 못하므로 쓰지 않는다. 계정 생성처럼 다른 기능의 표를 채워야 하면 소유 기능이 함수(provisioning)를 내고 합성 루트가 주입한다.
- 외래 키에는 인덱스를 둔다.
- 결재 문서에는 기안·결재 시점의 부서명·직위·직책을 **스냅샷 컬럼(jsonb)** 으로 저장한다 (PRD ORG-017).

## 2. 도메인별 필수 구현
| 대상 | 규칙 | PRD |
|---|---|---|
| 부서 트리 | 구체화 경로 `path`+`depth` 컬럼(ADR 0006). 생성·이동 시 트리거가 depth·path를 계산하고 `depth ≤ account.max_dept_depth`·같은 사업자·순환을 검증 | ORG-010~013 |
| 주소속 | 사용자당 주소속 1개 — 부분 유니크 인덱스 | ORG-032 |
| 문서번호 | 시리즈 행을 `SELECT … FOR UPDATE`로 잠근 뒤 채번. 누락·중복이 없어야 함 | APV-060~061 |
| 결재 단계 처리 | 낙관적 잠금(`version` 컬럼) + 멱등 키 | APV-045 |
| 결재 처리 기록 | `approval_action`은 추가만 함 (append-only) | APV-046 |
| 감사 로그 | `audit_log`는 앱 DB 계정에 **INSERT·SELECT 권한만** 부여. 월별 파티션은 필요해질 때 적용 | AUD-022 |
| 검색 | 한국어 부분 일치는 `pg_trgm` GIN 인덱스 사용 (기본 전문 검색은 한국어 형태소를 지원하지 않음) | APV-082 |

## 3. 마이그레이션
- **새 마이그레이션 첫 줄에 `-- feature: <기능|shared>`를 쓴다**(영향 범위 추적, 0022부터 `table-ownership` 게이트가 확인한다. 이전 마이그레이션은 소급하지 않는다). 새 테넌트 테이블의 격리 시험은 소유 기능의 `tests/`에 둔다.
- `drizzle-kit generate`로 만든 SQL을 커밋한다. **이미 적용된 마이그레이션 파일은 수정하지 않는다.**
- 하위 호환 원칙(expand → migrate → contract)을 따른다. 컬럼 삭제·이름 변경은 두 번의 배포로 나눈다.
- RLS 정책, 권한(GRANT), 트리거도 마이그레이션에 포함한다. 확장·권한·RLS처럼 drizzle-kit이 만들지 않는 SQL은 `drizzle-kit generate --custom --name=<이름>`으로 빈 마이그레이션을 만든 뒤 작성한다.
- **테이블 권한은 기본 권한(default privileges)에 기대지 않고 테이블마다 명시적으로 부여한다.** 새 테이블을 만들면 `fmerp_app`·`fmerp_auth` 중 누가 어떤 권한(SELECT·INSERT·UPDATE·DELETE, 필요하면 열 단위)을 가져야 하는지 정해 같은 마이그레이션에 넣는다.
- 운영 배포 직전에는 수동 덤프가 자동으로 실행된다 (DEPLOYMENT_PLAN 9.4).

## 4. DB 연결
- 드라이버는 `pg`(node-postgres) 하나로 통일한다. Drizzle, pg-boss, Better Auth가 같은 풀 설정을 쓴다.
- DB 역할은 셋으로 나눈다 (`docker/postgres/initdb/01-roles.sh`, 운영 DB도 같은 스크립트, ADR 0005).
  - `fmerp_migrator`: DB·`public` 스키마 소유자, 마이그레이션(DDL) 전용 — `MIGRATION_DATABASE_URL`
  - `fmerp_app`: 업무 데이터. 마이그레이션에서 부여한 권한만 가지며 **RLS가 적용**된다. pg-boss용 `pgboss` 스키마 소유자이며, pg-boss 설치 때문에 DB CREATE 권한을 가진다 ([ts](../ts/2026-10-03-pgboss-schema-permission.md)) — `DATABASE_URL`
  - `fmerp_auth`: Better Auth 전용(BYPASSRLS). 인증·테넌트 테이블과 감사 로그 기록·본인 이력 조회만 — `AUTH_DATABASE_URL`. **업무 데이터 코드에서 이 연결을 쓰지 않는다.**
- 마이그레이션 실행 코드는 `@fmerp/db/migrate`로만 import한다. 패키지 진입점에 넣지 않는다 ([ts](../ts/2026-10-03-next-monorepo-env-and-bundling.md)).

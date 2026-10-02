# 데이터베이스 규칙

기준: [PRD 7장 데이터 모델](../PRD.md) · [TECH_SPEC 3장](../TECH_SPEC.md)
스킬: **`supabase-postgres-best-practices`** — 스키마·마이그레이션·RLS·인덱스·쿼리를 다루기 전에 반드시 로드

## 1. 스키마
- 테이블과 컬럼 이름은 영문 소문자 snake_case를 쓴다.
- 테넌트 데이터 테이블은 `account_id NOT NULL`을 갖고 **RLS 정책**을 적용한다. 요청 처리 트랜잭션 안에서 `SET LOCAL app.account_id`로 테넌트를 지정한다.
- 새 테넌트 테이블을 만들면 **테넌트 격리 테스트**(다른 계정 데이터가 조회되지 않음)를 함께 작성한다.
- 외래 키에는 인덱스를 둔다.
- 결재 문서에는 기안·결재 시점의 부서명·직위·직책을 **스냅샷 컬럼(jsonb)** 으로 저장한다 (PRD ORG-017).

## 2. 도메인별 필수 구현
| 대상 | 규칙 | PRD |
|---|---|---|
| 부서 트리 | `ltree` 또는 경로 컬럼으로 구현. 생성·이동 시 트리거로 `depth ≤ account.max_dept_depth`를 검증 | ORG-010~013 |
| 주소속 | 사용자당 주소속 1개 — 부분 유니크 인덱스 | ORG-032 |
| 문서번호 | 시리즈 행을 `SELECT … FOR UPDATE`로 잠근 뒤 채번. 누락·중복이 없어야 함 | APV-060~061 |
| 결재 단계 처리 | 낙관적 잠금(`version` 컬럼) + 멱등 키 | APV-045 |
| 결재 처리 기록 | `approval_action`은 추가만 함 (append-only) | APV-046 |
| 감사 로그 | `audit_log`는 앱 DB 계정에 **INSERT·SELECT 권한만** 부여. 월별 파티션은 필요해질 때 적용 | AUD-022 |
| 검색 | 한국어 부분 일치는 `pg_trgm` GIN 인덱스 사용 (기본 전문 검색은 한국어 형태소를 지원하지 않음) | APV-082 |

## 3. 마이그레이션
- `drizzle-kit generate`로 만든 SQL을 커밋한다. **이미 적용된 마이그레이션 파일은 수정하지 않는다.**
- 하위 호환 원칙(expand → migrate → contract)을 따른다. 컬럼 삭제·이름 변경은 두 번의 배포로 나눈다.
- RLS 정책, 권한(GRANT), 트리거도 마이그레이션에 포함한다.
- 운영 배포 직전에는 수동 덤프가 자동으로 실행된다 (DEPLOYMENT_PLAN 8.3).

## 4. DB 연결
- 드라이버는 `pg`(node-postgres) 하나로 통일한다. Drizzle, pg-boss, Better Auth가 같은 풀 설정을 쓴다.
- 앱 계정과 마이그레이션 계정을 분리한다.

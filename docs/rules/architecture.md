# 아키텍처 규칙

기준: [TECH_SPEC 4장](../TECH_SPEC.md) · [DEPLOYMENT_PLAN 4·6장](../DEPLOYMENT_PLAN.md)

## 1. 저장소와 의존 방향
```
apps/web (Next 16 + Hono /api) ─┐
apps/worker (pg-boss 작업)      ─┼─> packages/auth, packages/storage ─> packages/db ─> packages/core
```
- `packages/core`: 결재 엔진과 도메인 규칙. **순수 TypeScript**이며 DB, HTTP, 파일, 현재 시각, 난수를 직접 쓰지 않는다. 시각·ID는 인자로 주입받는다.
- `packages/db`: Drizzle 스키마, 마이그레이션, RLS, 저장소(repository) 함수.
- `packages/storage`: S3 호환 어댑터. **S3 SDK는 이 패키지 밖에서 import하지 않는다.**
- `packages/auth`: Better Auth 설정, 결재 PIN.
- 역방향 import(예: core → db)와 apps 간 import는 금지한다.

## 2. 실행 단위
| 단위 | 하는 일 | 하지 않는 일 |
|---|---|---|
| `apps/web` | 화면, API, 인증, 서명 URL 발급, 작업 큐 등록 | PDF 생성, 내보내기 ZIP, DB 덤프 같은 장시간 작업 |
| `apps/worker` | PDF·완료 패키지 생성, 내보내기, 일일·수동 DB 덤프, 알림 발송, 예약 작업 | HTTP API 제공 (헬스체크만) |

## 3. 공통 처리
- **환경 변수:** 앱마다 하나의 `env` 모듈에서 Zod로 검증해 읽는다. 그 밖의 곳에서 `process.env`에 직접 접근하지 않는다.
- **시간:** DB에는 UTC(`timestamptz`)로 저장하고, 화면에는 Asia/Seoul로 표시한다 (PRD NFR-U05).
- **금액:** 원 단위 정수만 쓴다. 부동소수점 계산은 금지한다.
- **결재 상태 전이:** 반드시 `packages/core`의 함수를 거친다. API나 worker에서 상태 값을 직접 바꾸지 않는다 (PRD 5.4.1).

## 4. 미정 항목 (프로젝트 골격 생성 시 ADR로 확정)
- 기본 키 타입 (UUID v7 / bigint identity)
- DB의 금액 컬럼 타입과 앱 내부 표현
- API 에러 응답 형식
- 통합 테스트용 PostgreSQL 실행 방식

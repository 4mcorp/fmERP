# 테스트 규칙

기준: [PRD 9장 시나리오·수용 기준](../PRD.md) · [TECH_SPEC 3장](../TECH_SPEC.md)
스킬: **`tdd`**(결재 엔진 등 규칙이 복잡한 로직), **`playwright-cli`**(화면·E2E), **`diagnosing-bugs`**(원인 불명 버그)

## 1. 계층별 기준
| 계층 | 도구 | 필수 대상 |
|---|---|---|
| 단위 | Vitest 4.1 | `packages/core` 전체 — 결재 상태 전이, 병렬 합의, 전결, 대결, 후결, 결재선 검증, 부서 뎁스 규칙 |
| 통합 | Vitest 4.1 + 실제 PostgreSQL 18 | 테넌트 격리(RLS), 문서번호 채번 동시성, 감사 로그 INSERT 전용 권한, 마이그레이션 적용 |
| E2E | Playwright 1.63 | PRD 9장 시나리오 S1~S7 |

## 2. 규칙
- 결재 엔진과 같은 도메인 규칙은 `tdd` 스킬로 **테스트를 먼저** 작성한다.
- DB 관련 테스트는 목(mock) 대신 실제 PostgreSQL로 실행한다. 테스트 파일 이름은 단위 `*.test.ts`, 통합 `*.int.test.ts`(Vitest `integration` 프로젝트, 먼저 `pnpm env:up`), E2E `apps/web/e2e/*.spec.ts`.
- globalSetup에서는 `process.env`가 아니라 `project.config.env`를 읽는다 ([ts](../ts/2026-10-03-vitest-globalsetup-env.md)).
- **통합·E2E 테스트는 테스트 DB(55433)만 쓴다.** 실행마다 초기화(`@fmerp/db/test/reset`)하고 시드 계정을 넣는다. 개발 DB(55432)는 건드리지 않는다 ([ts](../ts/2026-10-03-e2e-dev-server.md)).
- 로그인이 필요한 테스트는 시드 계정을 쓴다: 통합 테스트는 `apps/web/server/test-client.ts`의 `loginAs(email)`, E2E는 `/dev-login` 화면.
- DB 오류(권한, RLS)를 확인할 때 drizzle은 PostgreSQL 오류를 `cause`에 감싸므로 `cause.message`로 비교한다 (`m1.int.test.ts`의 `expectPgError`).
- DB 상태를 바꾸는 E2E에는 `@stateful` 태그를 단다 (모바일 프로젝트에서 제외되어 한 번만 실행됨).
- 통합 테스트는 파일 실행 순서와 다른 테스트가 남긴 데이터에 의존하지 않는다(같은 코드·같은 구성원의 데이터가 섞일 수 있다). 조회는 자기 데이터로 좁히고, 상태를 바꾸는 테스트는 고유한 코드·사유를 쓴다.
- 버그를 고칠 때는 재현 테스트를 먼저 추가한다.
- 테스트를 통과시키려고 테스트를 약하게 바꾸지 않는다. 기대값을 바꿔야 하면 이유를 보고한다.

## 3. 완료 기준
작업 완료를 보고하기 전에 다음을 확인한다. 실행하지 못한 항목은 실행하지 못했다고 보고한다.
- `pnpm typecheck`
- `pnpm lint`
- 변경과 관련된 테스트
- 화면이 바뀌었다면 화면 확인

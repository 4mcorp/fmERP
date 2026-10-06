# 4mERP

전자결재 중심 ERP (사용자 100명 이하, 사내 로컬 서버 Docker + Cloudflare Tunnel + 외부 S3). 사용자와의 대화와 문서는 한국어로 작성한다.

## 작업 절차 (모든 요청에 적용)
1. **공통 규칙 확인:** 이 파일의 규칙을 따른다.
2. **색인 조회:** [docs/INDEX.md](docs/INDEX.md)에서 요청과 관련된 세부 규칙, 기준 문서 섹션, 스킬을 찾는다.
3. **세부 규칙 읽기:** 찾은 `docs/rules/*.md`와 기준 문서의 **해당 섹션만** 읽는다. 문서 전체를 읽지 않는다.
4. **트러블슈팅 확인:** INDEX의 트러블슈팅 목록에서 요청 영역과 태그가 겹치는 `docs/ts/` 항목을 읽고, 각 항목의 "재발 방지 규칙"을 이번 작업에 적용한다.
5. **수행·검증:** 작업한 뒤 완료 기준(타입 검사, 린트, 관련 테스트, 화면 확인)을 확인하고 나서 완료라고 보고한다.
6. **산출물 정리:** 작업 중 생긴 계획은 `docs/plan/`, 문제 해결 기록은 `docs/ts/`, 아이디어·보류안은 `docs/idea/`에 남기고, **INDEX.md를 갱신한다** (규칙: [docs/rules/docs.md](docs/rules/docs.md)).

## 공통 규칙
### 스택 고정
Node 24 LTS · pnpm 11 · TypeScript ~6.0 · Next 16.3 + Hono 4.13(`/api`) · PostgreSQL 18 · Drizzle 0.45 · Better Auth 1.7 · Zod 4 · pg-boss 12 · Tailwind 4 + shadcn(Radix) · Vitest 4.1 · Playwright 1.63 · Biome 2.5
- 버전 변경과 새 패키지 추가는 [docs/rules/dependencies.md](docs/rules/dependencies.md)를 따르고, 사용자 승인을 받는다.
- 라이브러리 API는 학습 데이터보다 최신일 수 있다. 라이브러리 코드를 작성하거나 설정할 때는 Context7 MCP로 위 버전의 문서를 확인한다.

### 깨면 안 되는 불변 조건
- 모든 테넌트 데이터는 `account_id` + RLS로 격리한다. 테넌트 경계를 넘는 쿼리는 금지한다.
- 감사 로그(`audit_log`)는 INSERT만 한다. UPDATE·DELETE 코드는 금지한다.
- 완료 문서 패키지(S3 `final/`)는 한 번만 쓴다. 문서 본문·첨부는 S3에, DB에는 색인·상태·S3 키만 둔다.
- `packages/core`(결재 엔진·도메인)는 프레임워크·DB·네트워크를 import하지 않는다.
- 비밀정보(키, 토큰, `.env`)와 고객 데이터는 커밋하거나 로그·외부 도구 질의에 넣지 않는다.

### 작업 원칙
1. **먼저 생각한다:** 요구사항이 모호하면 가정하지 말고 질문한다. 해석이 여러 개면 제시한다.
2. **단순하게:** 요청된 것만 만든다. 추측성 추상화·옵션·설정을 추가하지 않는다.
3. **필요한 부분만 수정:** 관련 없는 코드·주석·포맷은 건드리지 않는다.
4. **검증으로 끝낸다:** 검증하지 못한 부분은 검증하지 못했다고 보고한다.
- 여러 파일을 훑는 조사는 서브에이전트(Explore)에 맡기고 결론만 받는다.

### 커밋
`<type>(<scope>): <한국어 설명>` 형식을 쓴다. 커밋·푸시는 사용자가 요청할 때만 한다. 세부 사항: [docs/rules/git.md](docs/rules/git.md)

## 명령어
린트 `pnpm lint` · 타입 `pnpm typecheck` · 단위 `pnpm test:unit` · 통합 `pnpm test:int`(먼저 `pnpm env:up`) · E2E `pnpm test:e2e` · 마이그레이션 `pnpm db:generate`/`pnpm db:migrate` · 시드 `pnpm db:seed` · 개발 `pnpm dev`
- 로그인은 소셜 로그인(M9) 전까지 **시드 테스트 계정**으로 한다: 화면 `/dev-login`, 통합 테스트 `loginAs(email)` (`apps/web/server/test-client.ts`).
- **개발 서버를 켜기 전, 또는 `packages/db/migrations`에 새 파일이 생겼을 때는 `pnpm db:migrate`(필요하면 `pnpm db:seed`)를 먼저 실행한다.** 개발 DB는 자동 갱신되지 않아, 놓치면 화면이 비고 API가 500이 된다 ([ts](docs/ts/2026-10-04-dev-db-not-migrated.md)).
- `pnpm`이 PATH에 없으면 `corepack pnpm@11.28.3 <명령>`을 쓴다 ([ts](docs/ts/2026-10-03-windows-pnpm-not-on-path.md)).
- 테스트 파일: 단위 `*.test.ts`, 통합 `*.int.test.ts`(실제 DB·S3), E2E `apps/web/e2e/*.spec.ts`.
- **구조 검사:** `pnpm arch:check`(기능 간 import·순환·미사용 코드·억제 주석을 기준선과 비교), `pnpm arch:guard`(한도 증가 감지), 한꺼번에 `pnpm verify`. 새 위반은 기준선에 넣지 말고 **고친다.** `tools/baselines/`·`.dependency-cruiser.cjs`·`knip.json`·`biome.json`은 사람의 승인 없이 느슨하게 바꾸지 않는다. `pnpm arch:baseline`은 위반을 **줄였을 때만** 쓴다. 새 소스 파일은 `tools/src/feature-assignment.ts`에 배정되어야 한다. 구조 전환은 [계획](docs/plan/2026-10-06-feature-architecture-refactor.md) 12장의 세션 순서를 따른다.

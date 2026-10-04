# fmERP (4mERP)

전자결재 중심 ERP. 소셜 로그인(Google·Naver), 계정 → 사업자 → 부서(최대 5단계) → 사용자 조직 구조, 기안·결재·감사, S3 문서 원본 보관과 이관을 지원합니다.

> 현재 단계: M1(계정·테넌트·감사 로그 기반, 테스트 로그인) 완료, M2(조직·권한) 착수 전

## 문서
| 문서 | 내용 |
|---|---|
| [docs/INDEX.md](docs/INDEX.md) | **색인** — 규칙·문서·스킬·산출물 위치 |
| [docs/rules/](docs/rules/) | 구현 세부 규칙 |
| [docs/PRD.md](docs/PRD.md) | 제품 요구사항 정의서 |
| [docs/TECH_SPEC.md](docs/TECH_SPEC.md) | 확정 기술 스택·버전·저장소 구조·스킬 |
| [docs/DEPLOYMENT_PLAN.md](docs/DEPLOYMENT_PLAN.md) | 배포·백업·이관 계획 |
| [docs/TECH_CANDIDATES.md](docs/TECH_CANDIDATES.md) | 기술 스택·스킬·UI 후보 비교 기록 |
| [docs/HARNESS_CANDIDATES.md](docs/HARNESS_CANDIDATES.md) | Claude 부가 도구 비교 |
| [docs/adr/](docs/adr/) | 설계 결정 기록 |

## 개발 환경 준비
필요한 것: Node.js 24, Docker Desktop(또는 Docker Engine), Git

1. **pnpm 활성화 (1회):** 관리자 권한 PowerShell에서 실행합니다. Node가 `Program Files`에 설치되어 있으면 일반 권한으로는 실패합니다 ([ts](docs/ts/2026-10-03-windows-pnpm-not-on-path.md)).
   ```powershell
   corepack enable
   ```
2. **환경 변수:** `.env.example`을 `.env`로 복사합니다 (개발용 기본값이 들어 있음).
3. **설치와 로컬 서비스 기동**
   ```bash
   pnpm install
   pnpm env:up
   pnpm db:migrate
   pnpm db:seed
   ```
   > **새 마이그레이션이 생기면(`git pull` 뒤, 또는 `packages/db/migrations`에 파일이 늘었을 때) `pnpm dev` 전에 `pnpm db:migrate`를 다시 실행하세요.** 개발 DB는 자동으로 갱신되지 않아, 놓치면 로그인 후 화면이 비고 API가 500을 돌려줍니다. 자동 테스트는 별도 DB를 매번 초기화해서 이 문제를 잡지 못합니다 ([ts](docs/ts/2026-10-04-dev-db-not-migrated.md)). 조직·양식 시드가 늘었을 때는 `pnpm db:seed`도 실행합니다(시드는 upsert라 반복해도 안전하며, 다시 로그인해야 할 수 있습니다).
4. **실행:** `pnpm dev` → 웹 http://localhost:3000 → **테스트 로그인 화면(`/dev-login`)에서 시드 계정을 골라 로그인** (API 문서 `/api/doc`), worker 헬스체크 http://localhost:3001/health, 개발 메일함 http://localhost:58025

| 명령 | 내용 |
|---|---|
| `pnpm dev` | web + worker 동시 실행 |
| `pnpm lint` / `pnpm lint:fix` | Biome 검사 / 자동 수정 |
| `pnpm typecheck` | 전체 타입 검사 |
| `pnpm test:unit` | 단위 테스트 (Docker 불필요) |
| `pnpm test:int` | 통합 테스트 (테스트 DB·로컬 S3 필요: `pnpm env:up`) |
| `pnpm test` | 단위 + 통합 |
| `pnpm test:e2e` | E2E (Playwright, 최초 1회 `pnpm --filter @fmerp/web exec playwright install chromium`) |
| `pnpm db:generate` / `pnpm db:migrate` | 마이그레이션 생성 / 적용 |
| `pnpm db:seed` | 개발용 테스트 계정·회사 생성 (계정 목록: `packages/auth/src/test-accounts.ts`). 소셜 로그인은 마지막 단계(M9)에서 연결 |
| `pnpm env:up` / `pnpm env:down` | 로컬 PostgreSQL·SeaweedFS·Mailpit 기동 / 종료 |

커밋하면 lefthook이 변경 파일을 Biome로 검사하고, 커밋 메시지를 commitlint로 검사합니다 ([docs/rules/git.md](docs/rules/git.md)).

## 스택
Node.js 24 LTS · pnpm 11 · TypeScript 6 · Next.js 16 + Hono · PostgreSQL 18 · Drizzle · Better Auth · shadcn/ui · Docker Compose (사내 로컬 서버 + Cloudflare Tunnel)

## AI 에이전트 작업
에이전트 작업 절차·공통 규칙은 [CLAUDE.md](CLAUDE.md), 작업 산출물은 `docs/plan`·`docs/ts`(트러블슈팅)·`docs/idea`, 프로젝트 스킬은 `.claude/skills/`(출처·해시: `skills-lock.json`)에 있습니다.

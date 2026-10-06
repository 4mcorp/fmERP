# 4mERP 기술 스펙

| 항목 | 내용 |
|---|---|
| 문서 버전 | v1.0 |
| 작성일 | 2026-10-03 |
| 상태 | **확정** (후보 비교: [TECH_CANDIDATES.md](./TECH_CANDIDATES.md)) |
| 관련 문서 | [PRD](./PRD.md) · [배포 계획서](./DEPLOYMENT_PLAN.md) · [Claude 부가 도구 비교](./HARNESS_CANDIDATES.md) |

---

## 1. 결정 사항

| # | 항목 | 결정 |
|---|---|---|
| D1 | UI 컴포넌트 | **shadcn/ui** (공식 MCP + 공식 스킬) + **tablecn** 데이터 그리드. 테마는 tweakcn |
| D2 | shadcn 기반 라이브러리 | **Radix UI** |
| D3 | 개발 방법론 스킬 | **mattpocock/skills** (grill-me, tdd, domain-modeling, diagnosing-bugs) |
| D4 | 브라우저 테스트 스킬 | **microsoft/playwright-cli** |
| D5 | 린트·포맷 | **Biome** |
| D6 | 앱 구성 | **Next.js 안에 Hono 탑재** (`apps/web`) + `apps/worker` |
| D7 | DB | **PostgreSQL 18** |
| D8 | 양식 빌더 MVP | **필드 나열 + 표 + 리치 텍스트** (자유 배치 레이아웃 제외) |
| D9 | HWP 미리보기 | **제외** |

---

## 2. 런타임 · 도구 버전

> **버전 고정 정책:** `package.json`에는 `~`(패치 업데이트만 허용)로 적고, lockfile로 정확한 버전을 고정합니다. 메이저·마이너 업데이트는 Renovate PR을 거쳐 수동으로 승인합니다.

| 구분 | 버전 | 비고 |
|---|---|---|
| Node.js | **24.x LTS** (검증 시점 24.21) | `.nvmrc` = `24`, `engines.node` = `>=24 <25`. 지원 종료 2028-04-30 |
| pnpm | **11.x** (검증 시점 11.28.3) | `packageManager: "pnpm@11.28.3"` |
| TypeScript | **~6.0.3** | 7.0은 typescript-eslint 등 생태계 지원을 기다린 뒤 검토 |
| PostgreSQL | **18.x** (Docker `postgres:18-bookworm`) | 지원 종료 2030-11. 확장: `ltree`, `pg_trgm` |
| 서버 OS | **Ubuntu Server 26.04 LTS** + Docker Engine (Desktop 아님) | 지원 종료 2031-05. 로컬 서버 + Cloudflare Tunnel 구성 (DEPLOYMENT_PLAN 3·4장) |
| Docker 이미지 | `node:24-bookworm-slim`, `mcr.microsoft.com/playwright:v1.63.0-noble`(worker), `postgres:18-bookworm`, `cloudflare/cloudflared:2026.9.3` | Playwright 이미지 버전은 npm 버전과 반드시 일치. 리버스 프록시(Caddy)는 사용하지 않음 |

---

## 3. 라이브러리 버전 (검증 완료)

| 영역 | 패키지 | 버전 |
|---|---|---|
| 웹 프레임워크 | next | ~16.3.8 |
| | react, react-dom | ~19.3.0 |
| API | hono | ~4.13.12 |
| | @hono/zod-openapi | ~1.6.3 |
| | @hono/node-server | ~2.1.3 (worker의 헬스체크 서버용) |
| 검증 | zod | ~4.6.5 |
| 인증 | better-auth | ~1.7.7 (organization 플러그인 = 계정·테넌트, ADR 0005). `@better-auth/passkey`는 P1에서 같은 버전으로 추가 |
| 비밀번호·PIN 해시 | @node-rs/argon2 | ~2.2.1 |
| ORM | drizzle-orm / drizzle-kit | ~0.45.3 / ~0.31.11 |
| DB 드라이버 | pg | ~8.23.1 (Drizzle·pg-boss·Better Auth 공용) |
| 작업 큐 | pg-boss | ~12.35.1 |
| UI 기반 | tailwindcss, @tailwindcss/postcss | ~4.3.3 |
| | radix-ui | ~1.6.7 |
| | lucide-react | ~1.50.0 |
| | shadcn (CLI) | 4.x — 컴포넌트는 코드로 복사되므로 런타임 의존성 아님 |
| 서버 상태 | @tanstack/react-query | ~5.104.1 |
| 표 | @tanstack/react-table | ~9.2.4 (tablecn 기준) |
| 폼 | react-hook-form / @hookform/resolvers | ~7.89.0 / ~5.9.1 |
| 에디터 | @tiptap/react, @tiptap/pm, @tiptap/starter-kit | ~3.31.4 |
| 클라이언트 저장 | dexie | ~4.4.6 |
| 스토리지·메일 | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @aws-sdk/lib-storage(멀티파트 스트림 업로드, M7), @aws-sdk/client-sesv2 | ~3.1145.0 |
| 파일 처리 | archiver | ~8.0.0 (타입은 `@types/archiver` ~8.0.0, 타입 전용·MIT) |
| | write-excel-file | ~4.1.1 (**exceljs 대체**: exceljs는 2024-12 이후 업데이트가 없고 deprecated 하위 의존성 6개 포함) |
| 암호화 | age-encryption | ~0.3.1 (BSD-3-Clause, age 제작자 Filippo Valsorda 배포, 스트림 암·복호화 지원, 0.x. DB 덤프 암호화·복호화, M7) |
| 변경 비교 | microdiff | ~1.6.0 |
| 날짜 | date-fns | ~4.4.0 |
| 테스트 | vitest | ~4.1.11 |
| | @playwright/test | ~1.63.0 (PDF 생성에도 같은 버전 사용) |
| 린트·포맷 | @biomejs/biome | ~2.5.15 |
| Git hook·커밋 규칙 | lefthook / @commitlint/cli·config-conventional | ~2.1.16 / ~21.2.3 |
| TS 실행 (worker·스크립트) | tsx | ~4.23.15 |
| 구조 검사 (기능 경계·순환·순수성) | dependency-cruiser | ~18.5.0 (MIT, [기능 구조 전환 계획](plan/2026-10-06-feature-architecture-refactor.md)) |
| 미사용 코드·의존성 검사 | knip | ~6.39.0 (ISC) |
| 중복 코드 탐지 (공용 코드 정리) | jscpd | ~5.4.0 (MIT) |
| 커버리지 | @vitest/coverage-v8 | ~4.1.11 (vitest와 같은 버전) |
| 기능 지도 파서 (`tools`) | yaml | ~2.9.1 (ISC, feature.map.yaml 읽기) |
| UI 보조 (shadcn 설치) | shadcn, class-variance-authority, cn, tw-animate-css, sonner(알림), next-themes | ~4.21.1, ~0.7.1, ~0.4.0, ~1.4.0, ~2.0.8, ~0.4.6 |
| 로컬 개발 서비스 (Docker) | `postgres:18-bookworm`, `chrislusf/seaweedfs:4.47`(로컬 S3, MinIO 대체), `axllent/mailpit:v1.31`(개발 메일함) | docker-compose.dev.yml |
| 타입 | @types/node ~24, @types/react·@types/react-dom ~19.3.0, @types/pg | |

**구현 단계에서 추가할 예정인 패키지** (해당 기능을 만들 때 같은 방식으로 검증): `@headless-tree/react`(부서 트리), `@xyflow/react`(조직도), `@dnd-kit/*`(양식 빌더), `serwist`·`web-push`(P1 PWA).

### 3.1 호환성 검증 결과 (2026-10-03)
- 위 조합으로 `strictPeerDependencies: true`를 켠 상태에서 `pnpm install`이 **성공했고, peer 충돌은 0건**입니다(626개 패키지 해석).
- 남은 경고: drizzle-kit(개발 전용)의 deprecated 하위 의존성 `@esbuild-kit/*` 2개. 운영 번들에는 들어가지 않으며, drizzle-kit 1.0 정식판에서 해소될 예정입니다.
- 자동 조정한 항목은 [TECH_CANDIDATES.md 2.2절](./TECH_CANDIDATES.md)을 참조하세요(TypeScript 7→6, Vitest 5→4.1, Drizzle 1.0 RC→0.45, exceljs→write-excel-file).

---

## 4. 저장소 구조

```
4mERP/
├─ apps/
│  ├─ web/                    # 합성 루트 ①: Next.js 16 (app/ = 기능 화면의 한 줄 어댑터, server/app.ts = 기능 라우트 등록, 시드·시험 설정)
│  └─ worker/                 # 합성 루트 ②: pg-boss 작업 등록(main.ts), 운영자 CLI(cli/)
├─ features/                  # 기능 = pnpm 패키지(@fmerp/feature-<이름>). 다른 기능을 import할 수 없다
│  ├─ account/ org/ approval/ completion/ audit/ backup/ notification/ home/
│  │   ├─ feature.map.yaml    # 기능 지도(화면·접근·표·시험). 정합성은 CI가 검사
│  │   ├─ src/{domain,service,api,jobs,ui}/   # 순수 규칙 · 업무 로직 · Hono 라우트 · worker 작업 · 화면
│  │   └─ tests/              # 단위·통합 시험 (E2E는 apps/web/e2e)
├─ shared/                    # 공통 영역(@fmerp/shared): authz·server(http·env·오류)·contracts·domain(순수 규칙)·lib·ui(shadcn)·testing
├─ packages/
│  ├─ db/                     # Drizzle 스키마 전체(모든 표에 @owner), 마이그레이션(권한·RLS 포함), withTenant
│  ├─ audit/                  # 감사 로그 기록(recordAudit)·변경 비교(마스킹)
│  └─ storage/                # S3 호환 어댑터 (R2·S3·NCP·로컬 SeaweedFS)
├─ tools/                     # 구조 검사 도구(arch:check·guard·feature:*), 기준선(suppressions 허용 목록·커버리지 하한)
├─ docs/                      # 기준 문서(루트), INDEX.md, feature-map/(생성), rules/, plan/, ts/, idea/, adr/
├─ GLOSSARY.md                # 도메인 용어집 (domain-modeling 스킬이 관리)
├─ CLAUDE.md                  # 에이전트 작업 규칙
├─ .claude/skills/            # 프로젝트 스킬 (git으로 공유, feature-map 포함)
├─ skills-lock.json           # 스킬 출처·해시 고정
└─ .mcp.json                  # shadcn MCP
```

**의존 방향:** 기능 → `shared`(+ `packages/{db,audit,storage}`)만. 기능끼리·`shared`→기능은 없다. 합성 루트(`apps/*`)만 여러 기능을 import하며 기능이 내보낸 진입점(`api/routes`, `jobs/jobs`, `ui/pages/*` 등)만 쓴다. 기능이 다른 기능을 필요로 하면 ① `shared`로 승격 ② `shared/contracts`의 타입·포트 + 합성 루트 주입(함수·슬롯·provisioning) ③ 이벤트(`approval_event`). `shared/domain`과 기능의 `domain/`은 DB·프레임워크·네트워크를 import하지 않는 순수 TypeScript다. 다른 기능의 표는 소유자만 쓰고, 읽으려면 읽는 쪽 `feature.map.yaml`의 `tables.reads`에 선언한다. 근거: [ADR 0012](adr/0012-feature-structure-and-static-enforcement.md), 규칙: [rules/architecture.md](rules/architecture.md).

---

## 5. 공통 설정 기준

| 파일 | 내용 |
|---|---|
| `package.json` (루트) | `engines.node: ">=24 <25"`, `packageManager: "pnpm@11.28.3"` |
| `pnpm-workspace.yaml` | `packages: [apps/*, packages/*]`, **`strictPeerDependencies: true`**, `autoInstallPeers: false`, `allowBuilds: { esbuild: true, lefthook: true }` (빌드 스크립트가 필요한 패키지만 허용) — pnpm 11은 이 설정을 `.npmrc`가 아니라 이 파일에서 읽습니다 |
| `tsconfig.base.json` | `strict`, `noUncheckedIndexedAccess`, `moduleResolution: "bundler"`, `target: ES2024` |
| `biome.json` | 포맷과 린트 통합, import 정렬, `noExplicitAny: error` |
| `renovate.json` | 메이저 업데이트는 수동 승인. 출시 후 14일 대기. 그룹: `better-auth*`, `@tanstack/*`, `@aws-sdk/*`, `@tiptap/*`, Playwright npm 패키지와 Docker 이미지 동시 업데이트 |
| `.nvmrc` | `24` |

---

## 6. Claude 스킬 (설치 완료)

설치 위치: `.claude/skills/` (20개, 프로젝트 범위, 파일 복사 방식으로 git 공유). 출처와 해시는 `skills-lock.json`에 기록됩니다.

| 스킬 | 출처 | 언제 쓰나 |
|---|---|---|
| `grill-me` → `grilling` | mattpocock/skills | 기능을 만들기 전에 요구사항·설계를 질문으로 검증할 때 (`/grill-me`). grill-me는 grilling을 호출하는 진입점입니다 |
| `tdd` (+ 참조용 `codebase-design`) | mattpocock/skills | 결재 엔진처럼 규칙이 복잡한 로직을 테스트부터 작성할 때 |
| `domain-modeling` | mattpocock/skills | 용어를 정의하거나 ADR(설계 결정 기록)을 남길 때. `GLOSSARY.md`와 `docs/adr/`를 관리 |
| `diagnosing-bugs` | mattpocock/skills | 원인이 불분명한 버그나 성능 저하를 진단할 때 |
| `shadcn` | shadcn-ui/ui (공식) | UI 컴포넌트 추가·수정·스타일링 |
| `vercel-react-best-practices` | vercel-labs/agent-skills | React·Next 코드 작성·리뷰 |
| `web-design-guidelines` | vercel-labs/agent-skills | UI 접근성·UX 점검 (KWCAG 대응) |
| `supabase-postgres-best-practices` | supabase/agent-skills | 스키마·마이그레이션·RLS·인덱스·쿼리 작업 (Supabase와 무관하게 Postgres 일반 규칙) |
| `better-auth-best-practices`, `better-auth-security-best-practices` | better-auth/skills (공식) | 인증 설정·보안 강화 |
| `playwright-cli` | microsoft/playwright-cli | 브라우저로 화면 확인, E2E 테스트 작성. CLI(`@playwright/cli`)는 Playwright **알파** 버전에 의존하므로 저장소에 고정하지 않고 필요할 때 `npx @playwright/cli`로 실행 |
| `differential-review`, `semgrep`, `supply-chain-risk-auditor` | trailofbits/skills | 보안 관점의 변경 리뷰, 정적 분석, 의존성 공급망 위험 점검 |
| `find-skills` | vercel-labs/skills | 새 스킬 검색 |
| `git-commit` | github/awesome-copilot (MIT) | 변경 내용(diff)을 분석해 Conventional Commits 형식으로 커밋. 프로젝트 규칙(type·scope·한국어 설명)은 CLAUDE.md "커밋 규칙"을 따름 |

**설치 시 점검한 내용**
- 원격 실행(`curl | sh`), 자격 증명 접근, 지시 무시 유도 문구 같은 위험 패턴은 없었습니다.
- 포함된 스크립트(semgrep, supply-chain-risk-auditor)는 GitHub·npm·OSV·deps.dev·OpenSSF Scorecard 같은 공개 API만 호출합니다.
- 주의: `web-design-guidelines`는 실행할 때마다 `vercel-labs/web-interface-guidelines` 저장소에서 최신 규칙을 받아 옵니다(원격 내용에 의존). 문제가 생기면 규칙 파일을 저장소에 고정 복사하는 방식으로 바꿉니다.

**관리 명령**
```bash
npx skills list
```
```bash
npx skills update -p
```
업데이트 후에는 변경된 SKILL.md를 리뷰한 뒤 `skills-lock.json`과 함께 커밋합니다.

---

## 7. MCP 서버 (`.mcp.json`, 프로젝트 공유)

| 서버 | 방식 | 설정 | 용도 |
|---|---|---|---|
| shadcn | 로컬 프로세스 (stdio) | `cmd /c npx -y shadcn@4 mcp` | 컴포넌트 레지스트리(shadcn 기본, tablecn 등) 검색·설치 |
| context7 | 원격 (HTTP) | `https://mcp.context7.com/mcp` | 버전별 최신 라이브러리 문서 조회 (Next 16, Better Auth 1.7, Drizzle 0.45 등) |

**운영 메모**
- **Windows 실행 방식:** Windows에서는 `npx`를 셸 없이 실행하면 실패(ENOENT)하므로 shadcn은 `cmd /c`로 감쌉니다. macOS·Linux 개발자는 같은 이름(`shadcn`)으로 **local 범위**에 `npx -y shadcn@4 mcp`를 등록해 덮어씁니다(local 범위가 project 범위보다 우선).
- **Context7 원격 방식:**
  - 프로세스를 띄우지 않아 운영체제와 무관하게 동작합니다.
  - 서버 버전은 Upstash가 관리하므로 고정할 수 없습니다(검증 시점 4.1.1).
  - 조회 질의(라이브러리 이름, 질문)가 Upstash로 전송되므로 **고객 데이터나 비밀정보를 질의에 넣지 않습니다.**
- **Context7 API 키:** 키 없이 기본 사용량 한도로 씁니다. 한도에 걸리면 [context7.com/dashboard](https://context7.com/dashboard)에서 키를 발급받아, 같은 이름(`context7`)으로 local 범위에 `Authorization: Bearer <키>` 헤더를 넣어 등록합니다. 키는 저장소에 커밋하지 않습니다.
- 두 서버는 처음 사용할 때 Claude Code가 프로젝트 MCP 승인을 요청합니다.

그 밖의 부가 도구 검토 결과는 [HARNESS_CANDIDATES.md](./HARNESS_CANDIDATES.md)를 참조하세요.

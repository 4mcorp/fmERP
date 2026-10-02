# fmERP (4mERP)

전자결재 중심 ERP. 소셜 로그인(Google·Naver), 계정 → 사업자 → 부서(최대 5단계) → 사용자 조직 구조, 기안·결재·감사, S3 문서 원본 보관과 이관을 지원합니다.

> 현재 단계: 기획·설계 문서 확정, 구현 시작 전

## 문서
| 문서 | 내용 |
|---|---|
| [docs/INDEX.md](docs/INDEX.md) | **색인** — 규칙·문서·스킬·산출물 위치 |
| [docs/rules/](docs/rules/) | 구현 세부 규칙 |
| [docs/PRD.md](docs/PRD.md) | 제품 요구사항 정의서 |
| [docs/TECH_SPEC.md](docs/TECH_SPEC.md) | 확정 기술 스택·버전·저장소 구조·스킬 |
| [docs/DEPLOYMENT_PLAN.md](docs/DEPLOYMENT_PLAN.md) | 배포·백업·이관 계획 |
| [docs/TECH_CANDIDATES.md](docs/TECH_CANDIDATES.md) | 기술 스택·스킬·UI 후보 비교 기록 |
| [docs/HARNESS_CANDIDATES.md](docs/HARNESS_CANDIDATES.md) | Claude 부가 도구 비교 (검토 중) |

## 스택
Node.js 24 LTS · pnpm 11 · TypeScript 6 · Next.js 16 + Hono · PostgreSQL 18 · Drizzle · Better Auth · shadcn/ui · Docker Compose (사내 로컬 서버 + Cloudflare Tunnel)

## AI 에이전트 작업
에이전트 작업 절차·공통 규칙은 [CLAUDE.md](CLAUDE.md), 작업 산출물은 `docs/plan`·`docs/ts`(트러블슈팅)·`docs/idea`, 프로젝트 스킬은 `.claude/skills/`(출처·해시: `skills-lock.json`)에 있습니다.

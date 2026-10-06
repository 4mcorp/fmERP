# 4mERP 색인 (INDEX)

> 사용법: 요청을 받으면 **1장에서 작업 유형을 찾아** 세부 규칙과 기준 문서의 해당 섹션만 읽는다. 특정 주제의 위치는 **2장**에서 찾는다. 작업 전에 **5장 트러블슈팅**에서 태그가 겹치는 항목을 반드시 읽는다.
> 이 파일은 산출물(plan·ts·idea·adr·rules)을 추가하거나 바꿀 때마다 갱신한다 ([rules/docs.md](rules/docs.md)).

---

## 1. 작업 유형 → 읽을 것
| 작업 유형 | 세부 규칙 | 스킬 | 기준 문서 섹션 | ts 태그 |
|---|---|---|---|---|
| 모듈·패키지 구조, 새 패키지·앱 추가 | [rules/architecture.md](rules/architecture.md) | `codebase-design` | TECH_SPEC 4장 | `build` |
| DB 스키마, 마이그레이션, RLS, 쿼리 | [rules/database.md](rules/database.md) | `supabase-postgres-best-practices` | PRD 7장 | `db`, `migration` |
| API 라우트, 미들웨어, 권한 확인 | [rules/api.md](rules/api.md) | – | PRD 3.2·5.3·5.12 | `api`, `auth` |
| 화면, 컴포넌트, 폼, 표 | [rules/frontend.md](rules/frontend.md) | `shadcn`, `vercel-react-best-practices`, `web-design-guidelines` | PRD 8장·6.5 | `ui` |
| 로그인(테스트 계정·소셜), 세션, 결재 PIN, 계정·초대, 개인정보 | [rules/security.md](rules/security.md) | `better-auth-best-practices`, `better-auth-security-best-practices`, `organization-best-practices` | PRD 5.1·6.3·6.4, ADR 0005 | `auth`, `better-auth`, `security` |
| 조직(사업자·부서·직위·소속)·역할 권한, 관리 콘솔 | [rules/database.md](rules/database.md) 2장, [rules/api.md](rules/api.md) 3장 | `supabase-postgres-best-practices`, `shadcn` | PRD 5.2·5.3, ADR 0006 | `db`, `api`, `auth`, `ui` |
| 결재 엔진 (기안·결재선·처리·위임·채번) | [rules/architecture.md](rules/architecture.md) 3장, [rules/database.md](rules/database.md) 2장, [rules/testing.md](rules/testing.md), ADR 0007, GLOSSARY | `tdd`, `domain-modeling` | PRD 5.4 | `approval` |
| 감사 기능, 감사 로그 | [rules/security.md](rules/security.md), [rules/database.md](rules/database.md) | – | PRD 5.5 (Must·Should만 구현, 10.3 제외 목록) | `audit` |
| 파일 업로드, S3, 완료 패키지, 덤프, 이관 | [rules/storage-backup.md](rules/storage-backup.md), [ops/migration.md](ops/migration.md), ADR 0011 | – | PRD 5.6·5.10, DEPLOYMENT_PLAN 2·7장 | `storage`, `backup` |
| 테스트 작성, 버그 수정 | [rules/testing.md](rules/testing.md) | `tdd`, `diagnosing-bugs`, `playwright-cli` | PRD 9장 | `test` |
| 패키지 추가·버전 변경 | [rules/dependencies.md](rules/dependencies.md) | `supply-chain-risk-auditor` | TECH_SPEC 2·3·5장 | `deps`, `pnpm` |
| 커밋, 브랜치 | [rules/git.md](rules/git.md) | `git-commit` | – | `git` |
| 보안 리뷰, 정적 분석 | [rules/security.md](rules/security.md) 5장 | `differential-review`, `semgrep` | PRD 6.3 | `security` |
| 배포, 로컬 서버, Docker, Cloudflare Tunnel, CI/CD | – | – | DEPLOYMENT_PLAN 3·4·6·7·9장 | `infra`, `cloudflare` |
| 요구사항·설계 검증, 용어 정리 | [rules/docs.md](rules/docs.md) | `grill-me`, `domain-modeling` | PRD 전체 | – |
| 문서·산출물 작성 | [rules/docs.md](rules/docs.md) | – | – | – |
| Claude 설정 (스킬, MCP, hooks) | [rules/dependencies.md](rules/dependencies.md) | `find-skills` | TECH_SPEC 6·7장, HARNESS_CANDIDATES | `claude-code`, `skills`, `mcp` |

---

## 2. 주제별 위치
| 주제 | 위치 |
|---|---|
| 용어 정의 (계정, 사업자, 전결, 대결, 후결 등) | PRD 1.4 |
| 역할·권한 매트릭스 | PRD 3.2, 3.3 |
| 릴리스 단계 (Phase 0~4) | PRD 4장 |
| 소셜 로그인 (Google·Naver), 결재 PIN | PRD 5.1 (AUTH-001~016) |
| 조직 계층, 사업자 | PRD 5.2.1~5.2.2 (ORG-001~006) |
| 부서 뎁스 규칙 (1~5, 기본 1) | PRD 5.2.3 (ORG-010~020) |
| 소속·겸직·직위·직책 | PRD 5.2.4 (ORG-030~037) |
| 결재 문서 상태 흐름 | PRD 5.4.1 |
| 양식 빌더 (MVP: 필드 나열 + 표 + 리치 텍스트) | PRD 5.4.2 (APV-001~007), TECH_SPEC D8 |
| 기안·상신·임시저장 | PRD 5.4.3 (APV-010~020) |
| 결재선 유형·대상·전결 규정 | PRD 5.4.4 (APV-030~038) |
| 결재 처리·동시성 | PRD 5.4.5 (APV-040~048) |
| 부재·대결 | PRD 5.4.6 (APV-050~053) |
| 문서번호·완료 처리 | PRD 5.4.7 (APV-060~064) |
| 수신·공람·문서함·검색 | PRD 5.4.8~5.4.9 (APV-070~084) |
| ERP 모듈 결재 연동 | PRD 5.4.10 (APV-090~091), 5.11 |
| 감사 Must·Should 분류 | PRD 5.5 (AUD-001~030) |
| 제외한 감사 기능 | PRD 10.3 |
| 문서 원본 보관·덤프·내보내기 | PRD 5.6 (BAK-001~014) |
| 알림 | PRD 5.7 (NTF) |
| 관리자 콘솔 | PRD 5.9 (ADM) |
| 첨부 파일 | PRD 5.10 (FILE) |
| 비기능 요구사항 (성능·가용성·보안) | PRD 6.1~6.3 |
| 국내 법규 (전자문서법, 개인정보 안전성 확보조치 등) | PRD 6.4 |
| 데이터 모델·ERD | PRD 7장 |
| 화면 구성 (IA) | PRD 8장 |
| 수용 기준 시나리오 S1~S7 | PRD 9장 |
| 가정·오픈 이슈 | PRD 10.1~10.2 |
| S3 버킷 구조 | DEPLOYMENT_PLAN 2.1 |
| 서버 구성도·요청 흐름 | DEPLOYMENT_PLAN 3장 |
| 서버 하드웨어·OS 사양 | DEPLOYMENT_PLAN 4장 |
| 비용 (장비 1회 + 월) | DEPLOYMENT_PLAN 5장 |
| Docker Compose 서비스·네트워크·환경(스테이징) | DEPLOYMENT_PLAN 6장 |
| Cloudflare Tunnel·Access·무료 플랜 제약(100MB·100초) | DEPLOYMENT_PLAN 7장 |
| DB 덤프·복구 절차·이관 절차·로컬 사본 | DEPLOYMENT_PLAN 8장, [ops/migration.md](ops/migration.md)(운영자 절차), ADR 0011 |
| 서버 보안·원격 관리·모니터링·배포 절차 | DEPLOYMENT_PLAN 9장 |
| 스테이징 구축·배포·Access 절차 (초안, 미검증) | [ops/staging.md](ops/staging.md), `docker-compose.staging.yml`, `apps/web/Dockerfile`, `.env.staging.example` |
| 확정 결정 D1~D9 | TECH_SPEC 1장 |
| 개발용 테스트 계정 목록·비밀번호 | `features/account/src/service/test-accounts.ts` (시드: `pnpm db:seed` → `apps/web/server/seed-cli.ts`) |
| 테넌트(계정)·구성원·초대 구조, DB 역할 3개 | ADR 0005, rules/database.md 4장 |
| M1 보안 리뷰 결과·후속 과제 | plan/2026-10-03-m1-security-review.md |
| 결재 엔진 규칙(그룹·정족수·반려·후결·대결), 보안 리뷰·후속 과제 | ADR 0007, GLOSSARY.md, plan/2026-10-03-m3-approval-engine.md, plan/2026-10-03-m3-security-review.md |
| M8 알림·홈·텔레그램 설계, 보안 리뷰·후속 과제 | plan/2026-10-05-m8-notifications-home.md, plan/2026-10-06-m8-security-review.md |
| M2 조직·권한 설계, 보안 리뷰·후속 과제 | plan/2026-10-03-m2-org-permission.md, plan/2026-10-03-m2-security-review.md, ADR 0006 |
| 런타임·라이브러리 버전 | TECH_SPEC 2·3장 |
| 저장소 구조·의존 방향 | TECH_SPEC 4장, rules/architecture.md |
| pnpm·tsconfig·biome 설정 기준 | TECH_SPEC 5장 |
| 설치된 스킬과 용도 | TECH_SPEC 6장 |
| MCP 서버 (shadcn, Context7) | TECH_SPEC 7장 |
| 버전 자동 조정 근거 | TECH_CANDIDATES 2.2 |
| Claude 부가 도구 평가 | HARNESS_CANDIDATES |

---

## 3. 기준 문서
| 문서 | 내용 |
|---|---|
| [GLOSSARY.md](../GLOSSARY.md) | 도메인 용어집 (조직·결재 용어와 규칙 줄임 표현) |
| [PRD.md](PRD.md) | 제품 요구사항 (요구사항 ID 체계: AUTH, ORG, PERM, APV, AUD, BAK, NTF, DSH, ADM, FILE, API, BIL, NFR) |
| [TECH_SPEC.md](TECH_SPEC.md) | 확정 기술 스택·버전·구조·스킬·MCP |
| [DEPLOYMENT_PLAN.md](DEPLOYMENT_PLAN.md) | 배포·백업·이관 계획 |
| [TECH_CANDIDATES.md](TECH_CANDIDATES.md) | 스택·스킬·UI 후보 비교 기록 (결정 완료) |
| [HARNESS_CANDIDATES.md](HARNESS_CANDIDATES.md) | Claude 부가 도구 비교 |

---

## 4. 스킬 (`.claude/skills/`)
| 스킬 | 용도 |
|---|---|
| `grill-me` → `grilling` | 요구사항·설계를 질문으로 검증 |
| `tdd`, `codebase-design` | 테스트 우선 개발, 모듈 설계 용어 |
| `domain-modeling` | GLOSSARY.md·ADR 관리 |
| `diagnosing-bugs` | 원인 불명 버그 진단 |
| `shadcn` | UI 컴포넌트 |
| `vercel-react-best-practices` | React·Next 성능 |
| `web-design-guidelines` | 접근성·UX 점검 |
| `supabase-postgres-best-practices` | Postgres 스키마·쿼리·RLS |
| `better-auth-best-practices`, `better-auth-security-best-practices` | 인증 |
| `playwright-cli` | 브라우저 확인·E2E |
| `differential-review`, `semgrep`, `supply-chain-risk-auditor` | 보안 리뷰·정적 분석·의존성 위험 |
| `git-commit` | 커밋 |
| `find-skills` | 스킬 검색 |

---

## 5. 트러블슈팅 (`docs/ts/`) — 작업 전 태그가 겹치는 항목을 읽을 것
| 파일 | 태그 | 요약 (재발 방지 핵심) |
|---|---|---|
| [2026-10-03-windows-npx-mcp-enoent.md](ts/2026-10-03-windows-npx-mcp-enoent.md) | windows, mcp, npx, claude-code | Windows MCP 설정에서 `npx`는 `cmd /c`로 감싼다. 원격 HTTP 방식을 우선한다. 추가 후 `initialize` 응답을 확인한다 |
| [2026-10-03-pnpm11-config-location.md](ts/2026-10-03-pnpm11-config-location.md) | pnpm, deps, config | pnpm 설정은 `pnpm-workspace.yaml`에 둔다. 적용 값은 `pnpm config get`으로 확인한다 |
| [2026-10-03-skill-dependency-and-session-load.md](ts/2026-10-03-skill-dependency-and-session-load.md) | skills, claude-code | 스킬 설치 후 참조하는 스킬이 빠졌는지 확인한다. 설치 직후 인식되지 않으면 SKILL.md 절차를 직접 따른다 |
| [2026-10-03-windows-pnpm-not-on-path.md](ts/2026-10-03-windows-pnpm-not-on-path.md) | windows, pnpm, corepack, deps, build | pnpm이 PATH에 없으면 `corepack pnpm@11.28.3`을 쓴다. 사용자 PATH는 바꾸지 않고 README 1회 설정을 안내한다. 대화형 CLI는 `< /dev/null` + timeout |
| [2026-10-03-docker-desktop-stale-socket.md](ts/2026-10-03-docker-desktop-stale-socket.md) | docker, windows, infra, test | Docker 엔진 무응답 시 backend 로그에서 `backend crashed` 확인. 오래된 `Docker/run` 소켓 정리는 사용자 확인 후 |
| [2026-10-03-s3-presigned-checksum.md](ts/2026-10-03-s3-presigned-checksum.md) | storage, s3, aws-sdk, upload | S3 클라이언트 체크섬은 `WHEN_REQUIRED`. 서명 URL은 실제 fetch 업로드로 검증 |
| [2026-10-03-next-monorepo-env-and-bundling.md](ts/2026-10-03-next-monorepo-env-and-bundling.md) | next, build, env, monorepo, db | 공유 패키지 진입점에 Node 파일 경로 코드 금지(`exports` 분리). 루트 `.env`는 `loadEnvConfig(..., true)` |
| [2026-10-03-vitest-globalsetup-env.md](ts/2026-10-03-vitest-globalsetup-env.md) | test, vitest, config | globalSetup은 `project.config.env`를 읽는다. `No test files found`면 위의 설정 오류부터 확인 |
| [2026-10-03-python-escape-in-doc-edits.md](ts/2026-10-03-python-escape-in-doc-edits.md) | docs, windows, tooling | 백슬래시가 있는 문서는 Edit 도구로 고친다. 스크립트 수정 후 제어 문자 검사 |
| [2026-10-03-better-auth-integration.md](ts/2026-10-03-better-auth-integration.md) | auth, better-auth, db, security | 플러그인 추가 시 우회 HTTP 경로를 `disabledPaths`로 막는다. 어댑터 schema 키는 모델 이름. 설정 변경 후 m1 통합 테스트 실행 |
| [2026-10-03-e2e-dev-server.md](ts/2026-10-03-e2e-dev-server.md) | test, e2e, playwright, next | 페이지 이동은 `toHaveURL`로 먼저 확인. E2E는 테스트 DB만, 상태 변경 흐름은 `@stateful` |
| [2026-10-03-pgboss-schema-permission.md](ts/2026-10-03-pgboss-schema-permission.md) | db, worker, pg-boss, permission | 앱 계정은 pg-boss 설치용 DB CREATE 권한 필요. initdb 변경은 기존 볼륨에 수동 반영 |
| [2026-10-03-biome-windows-spawn.md](ts/2026-10-03-biome-windows-spawn.md) | windows, biome, claude-code, hooks, lint | Biome에는 상대 경로(`/`)를 넘기고 `stdio: "ignore"`를 쓰지 않는다. hook은 실제 결과로 검증한다 |
| [2026-10-03-drizzle-composite-fk-migration-order.md](ts/2026-10-03-drizzle-composite-fk-migration-order.md) | db, migration, drizzle | 기존 테이블에 UNIQUE를 추가하고 복합 외래 키로 참조하면 생성 SQL 순서를 확인·수정한다. 적용 전 통합 테스트로 확인 |
| [2026-10-03-playwright-label-region-and-shell-heredoc.md](ts/2026-10-03-playwright-label-region-and-shell-heredoc.md) | test, e2e, playwright, windows, tooling | 폼 컨트롤은 role(combobox)로 찾는다. 행 버튼엔 항목 이름이 든 aria-label. 긴 heredoc·`python -` 대신 파일 도구 |
| [2026-10-04-e2e-fix-loop-and-controlled-folder-access.md](ts/2026-10-04-e2e-fix-loop-and-controlled-folder-access.md) | windows, e2e, playwright, biome, defender, workflow | E2E 실패는 실패한 테스트만 재실행하고 전체는 단계 끝에 1회. 같은 실패 3회 반복 시 멈추고 보고. EPERM은 재시도 루프 대신 Windows 차단 기록 확인 |
| [2026-10-04-dev-db-not-migrated.md](ts/2026-10-04-dev-db-not-migrated.md) | db, migration, dev, test, workflow | 서버 시작 전·새 마이그레이션이 생기면 `pnpm db:migrate`(필요시 `db:seed`). 화면이 비고 API가 한꺼번에 500이면 개발 DB 마이그레이션을 먼저 의심. 화면 작업은 개발 서버에서 직접 열어 확인 |
| [2026-10-05-modal-dropdown-and-org-db-flake.md](ts/2026-10-05-modal-dropdown-and-org-db-flake.md) | ui, modal, select, test, flaky, db | 모달 안 드롭다운은 실제 마우스로 확인(배경 클릭 판정은 위치도 본다, ref에 인라인 함수 금지). 테스트에서 코드로 `find`할 때는 사업자 범위로 먼저 거르고 간헐 실패는 실제 값을 남겨 원인을 찾는다 |
| [2026-10-05-audit-view-race-and-concurrent-int-runs.md](ts/2026-10-05-audit-view-race-and-concurrent-int-runs.md) | audit, db, concurrency, test, flaky, worker | 여러 API를 동시에 부르는 화면의 "확인 후 기록"은 advisory lock으로 직렬화하고 동시 요청 테스트로 고정. 통합 테스트를 백그라운드로 걸고 같은 DB에 또 돌리지 않는다. 공유 큐는 시작 시 비운다 |
| [2026-10-05-backup-role-existing-volume.md](ts/2026-10-05-backup-role-existing-volume.md) | db, migration, backup, infra | 슈퍼유저만 만들 수 있는 DB 역할(fmerp_backup)은 기존 볼륨에 직접 SQL로 적용하고, 마이그레이션은 역할이 없으면 원인을 알리며 멈춘다 |
| [2026-10-05-m7-implementation-lessons.md](ts/2026-10-05-m7-implementation-lessons.md) | backup, db, test, flaky, git, workflow, ui, windows | 키셋 커서 시각은 마이크로초 문자열(2,000건 넘는 같은 시각 시험), 시험은 끝날 때 가짜 상태·PIN·객체를 되돌리고 전체를 연속 2회 통과, 커밋 후 `git log -1`로 확인, 프로세스는 내가 띄운 PID만 종료, 폼의 Radix Select는 빈 값 무시 |

---

## 6. 계획 (`docs/plan/`)
| 파일 | 상태 | 요약 |
|---|---|---|
| [2026-10-03-mvp-roadmap.md](plan/2026-10-03-mvp-roadmap.md) | accepted | MVP 마일스톤 M0~M8, P0 요구사항 118개 배정, 선행 작업·위험 |
| [2026-10-03-m0-scaffold.md](plan/2026-10-03-m0-scaffold.md) | done | M0 골격·개발 환경: 단계, 완료 기준, 결정 P1~P4 (ADR·로컬 S3·hook 도구) |
| [2026-10-03-m1-security-review.md](plan/2026-10-03-m1-security-review.md) | done | M1 보안 리뷰: 지적 SR-1~5 조치, 후속 FU-1~5 (업로드 크기·형식 검증은 M4) |
| [2026-10-03-m1-auth-account-audit.md](plan/2026-10-03-m1-auth-account-audit.md) | done | M1 계정·테넌트·감사 로그 기반: 시드 테스트 계정 로그인, Better Auth organization, RLS·`fmerp_auth`, 감사 로그, PIN (소셜 로그인은 M9) |
| [2026-10-03-m2-org-permission.md](plan/2026-10-03-m2-org-permission.md) | done | M2 조직·권한: 사업자·부서 트리(뎁스 규칙)·직위·소속·`role_grant`·`can()` 권한 판정, 관리 콘솔·조직도 |
| [2026-10-03-m2-security-review.md](plan/2026-10-03-m2-security-review.md) | done | M2 보안 리뷰: 권한 상승·테넌트 격리 점검, 후속 FU-6~10 |
| [2026-10-03-m3-approval-engine.md](plan/2026-10-03-m3-approval-engine.md) | done | M3 결재 엔진: 상태 머신·결재선·병렬 합의·대결·동시성·채번·완료 후 불변 |
| [2026-10-03-m3-security-review.md](plan/2026-10-03-m3-security-review.md) | done | M3 보안 리뷰: 처리 권한·불변성·기안자 권한 상승, 후속 FU-11~15 |
| [2026-10-03-m4-forms-drafting-approval-ui.md](plan/2026-10-03-m4-forms-drafting-approval-ui.md) | accepted | M4 양식·기안·결재 화면: 양식 빌더·버전, 본문 S3 리비전, 첨부(staging 검증), 처리 API·재인증, 모바일 결재 |
| [2026-10-04-m5-completion-mailbox.md](plan/2026-10-04-m5-completion-mailbox.md) | done | M5 완료 처리·문서함: 결재 PDF·완료 패키지(`final/` 한 번만 쓰기), 완료 이벤트 큐, 열람 권한 통합, 수신·공람·참조, 문서함·검색·내보내기, 일괄 이관 |
| [2026-10-05-m6-audit.md](plan/2026-10-05-m6-audit.md) | done | M6 감사 기능: 감사인 열람 기록, 문서 이력 타임라인, 인쇄 기록, 감사 로그 조회 화면, 월간 점검 |
| [2026-10-05-m6-security-review.md](plan/2026-10-05-m6-security-review.md) | done | M6 보안 리뷰: 관리자의 로그 경유 문서 내용 노출(S1)·타임라인 정보 노출(S2·S3)·인쇄 로그 범람(S4) 수정, 후속 FU-M6-1·2 |
| [2026-10-05-m7-backup-export-migration.md](plan/2026-10-05-m7-backup-export-migration.md) | done | M7 덤프·내보내기·이관: 암호화 DB 덤프(시스템 관리자), 계정 전체 내보내기 ZIP, 복원·리허설·색인 재구성 CLI, 이관 절차 |
| [2026-10-05-m7-security-review.md](plan/2026-10-05-m7-security-review.md) | done | M7 보안 리뷰: 앱 역할이 완료 상태·키를 직접 쓰는 문제(S1~S3)·덤프 멈춤(S4) 수정, 후속 FU-M7-1~3 |
| [2026-10-05-m8-notifications-home.md](plan/2026-10-05-m8-notifications-home.md) | done | M8 알림·홈·통합 검증: outbox 소비 알림(인앱·이메일), 홈 대시보드, E2E S2~S7, 스테이징 초안 |
| [2026-10-06-m8-security-review.md](plan/2026-10-06-m8-security-review.md) | done | M8 보안 리뷰: 계정 교차 조회의 이벤트 내용 노출(S1)·연결 완료 미감사(S2)·오류 문구의 매개변수(S3) 수정, 후속 FU-M8-1~5 |
| [2026-10-06-feature-architecture-refactor.md](plan/2026-10-06-feature-architecture-refactor.md) | done | 기능(feature) 단위 구조 전환 + 정적 분석 강제 체계(경계 4겹, Knip, feature map, 우회 방지) 계획과 도구 지정. **사용자 승인 대기** |

---

## 7. 아이디어·보류 (`docs/idea/`)
| 파일 | 상태 | 요약 |
|---|---|---|
| [2026-10-03-harness-reevaluation.md](idea/2026-10-03-harness-reevaluation.md) | parked | Serena, context-mode, hookify 등 조건부 재검토 대상 |
| PRD 10.3 | – | 제외한 감사 Optional 기능 7개와 대체 방법 |

---

## 8. 설계 결정 (`docs/adr/`)
| 파일 | 요약 |
|---|---|
| [0001-uuid-v7-primary-keys.md](adr/0001-uuid-v7-primary-keys.md) | 기본 키는 PostgreSQL 18 내장 `uuidv7()` |
| [0002-money-as-bigint-won.md](adr/0002-money-as-bigint-won.md) | 금액은 DB `bigint`(원), 앱 `number` + `toWon()` 검증 |
| [0003-rfc9457-problem-details.md](adr/0003-rfc9457-problem-details.md) | API 에러는 RFC 9457 Problem Details + `code` |
| [0004-integration-test-db.md](adr/0004-integration-test-db.md) | 통합 테스트는 Compose의 전용 PostgreSQL·SeaweedFS |
| [0005-better-auth-organization-as-tenant.md](adr/0005-better-auth-organization-as-tenant.md) | Better Auth organization = 계정(테넌트), `fmerp_auth` 역할, 자체 초대 |
| [0008-document-body-revisions-and-attachments.md](adr/0008-document-body-revisions-and-attachments.md) | 본문 S3 리비전·상신 내용 해시, 첨부 staging 검증 후 복사, 양식 불변 버전, 결재선·재인증 규칙, dnd-kit 미사용 |
| [0009-completion-package-and-document-search.md](adr/0009-completion-package-and-document-search.md) | 완료 패키지는 manifest를 마지막에 쓰는 한 번만 쓰기, 후결은 `post-approvals/`, 상태는 `document_package`, 열람 판정 통합, 검색은 상신 시 본문 텍스트 색인 |
| [0010-audit-view-log-and-timeline.md](adr/0010-audit-view-log-and-timeline.md) | 감사인 열람은 `read_all` 단독일 때만 10분 중복 억제로 기록(advisory lock), 타임라인은 `approval_action` 정본 병합, 월간 점검은 추가 전용 `audit_review` |
| [0011-backup-export-and-recovery.md](adr/0011-backup-export-and-recovery.md) | DB 덤프는 시스템 관리자만·서버에는 age 공개키만, 계정 내보내기는 소유자(허용 시 관리자)·worker 스트리밍, 복구는 패키지 형식 v2 `restore` 블록으로 색인 재구성 |
| [0012-feature-structure-and-static-enforcement.md](adr/0012-feature-structure-and-static-enforcement.md) | 기능 단위 폴더(기능별 패키지)+공통 영역, 기능 간 import 금지를 Biome·dependency-cruiser·Knip·자체 도구로 강제, 래칫 기준선·한도·CODEOWNERS, 스키마는 공통 영역에 한 번에(테이블 소유권 검사) |
| [0007-approval-engine-rules.md](adr/0007-approval-engine-rules.md) | 결재 엔진은 core 순수 함수, 낙관적 잠금·추가 전용·outbox 저장, 그룹·정족수·반려·후결·대결 규칙 |
| [0006-org-permission-model.md](adr/0006-org-permission-model.md) | 부서 트리는 구체화 경로+트리거, 역할은 `membership.role` + 범위 있는 `role_grant`, `can()` 한 곳 판정 |

---

## 9. 코드 위치
> 기능별 위치(화면·API·표·시험)는 **생성된 기능 지도 [feature-map/INDEX.md](feature-map/INDEX.md)** 가 기준이다(`pnpm feature:find`). 아래 표는 공통 영역과 도구 위주로 남긴다.
| 대상 | 경로 |
|---|---|
| 웹 화면 (App Router) | `apps/web/app/` — 로그인 필요 영역 `app/(app)/`(홈, `me`, `admin/members`, `onboarding`, `invite/[token]`), 테스트 로그인 `app/dev-login` |
| 홈 대시보드 (M8) — **`features/home/`** | `src/ui/pages/home.tsx` — 결재 대기·진행 중·최근 완료·자주 쓰는 양식 (`apps/web/app/(app)/page.tsx`는 어댑터), `feature.map.yaml` |
| 앱 공통 레이아웃·계정 전환 메뉴 | `apps/web/components/app-shell.tsx` |
| 화면 쪽 API 호출·타입 | `shared/src/lib/api.ts`, `shared/src/lib/types.ts`, `shared/src/lib/queries.ts` (기능 전용 훅·타입은 해당 기능의 `ui/queries.ts`) |
| shadcn 컴포넌트 / 유틸 | `shared/src/ui/`, `shared/src/lib/utils.ts` (`@fmerp/shared/ui/*`) |
| API (Hono, `/api/*`) | `apps/web/server/create-app.ts`(기본·헬스), `server/app.ts`(라우트 등록), `server/routes/*.ts`(auth·dev, me, accounts·invitations, account), Next 마운트 `app/api/[[...route]]/route.ts` |
| API 미들웨어 (세션·테넌트·역할·Origin·IP) | `shared/src/server/http.ts` |
| 서버 의존성(DB 연결 2개·Better Auth·저장소) | 타입 `shared/src/server/deps.ts`, 실제 연결(합성 루트) `apps/web/server/deps.ts` |
| API 에러 형식 (RFC 9457) | `shared/src/server/problem.ts` |
| 환경 변수 검증 | `shared/src/server/env.ts`, `apps/worker/src/env.ts` |
| 권한 판정 어댑터(`loadActor`·`authorize`), 서비스 컨텍스트·오류 | `shared/src/authz/org-access.ts`, `shared/src/server/{context,errors,service-context,common}.ts` |
| worker (pg-boss, 헬스체크) | `apps/worker/src/main.ts`, `src/health.ts` |
| 공통 도메인 규칙 (순수 함수) | `shared/src/domain/` — 권한 `permissions.ts`(`can()`), 양식 `form-{schema,values,index}.ts`, `doc-number.ts`, `completion-package.ts`, `approval-event.ts`, `engine-error-code.ts`, `pin-policy.ts`, `session-policy.ts` (시험은 같은 폴더). 기능 전용 규칙은 각 `features/*/src/domain/` |
| 결재 — **`features/approval/`** (엔진) | `src/domain/`(`approval-engine·state·line·line-edit·types`, `delegation`, `document-access`, `step-transfer`, `form-defaults`) — 순수 함수, 시험 `tests/` |
| 결재 서비스·API·화면 | `src/service/`(`service.ts` 상신·처리·채번, `store.ts` 잠금·저장, `drafts·attachments·comments·mailbox·search·transfer·recipients·forms·export` 등), `src/api/`(`routes.ts` 진입점, `*-routes.ts`, `guards.ts`), `src/provisioning.ts`(기본 양식 설치), `src/ui/{pages,components,queries.ts,local-drafts.ts}`, `feature.map.yaml`. 검사 `pnpm feature:check approval`. 어댑터 페이지는 `apps/web/app/(app)/{approval,mailbox,search,me/absence,admin/{approvals,forms}}` |
| 결재 스키마·트리거 | `packages/db/src/schema/approval.ts`, `migrations/0005_approval_engine.sql`, `0006_approval_rls_triggers.sql` |
| 조직·권한 — **`features/org/`** | API `src/api/`(`routes.ts` 진입점, `org-routes.ts` 설정·사업자·직위·직책, `departments-routes.ts` 부서·조직도·CSV, `members-routes.ts` 구성원·소속·발령·역할), `src/domain/`(`assignment`·`department-csv`·`department-tree`), `src/service/in-flight.ts`, 화면 `src/ui/{pages,components,queries.ts}`, 테스트 `tests/`. 검사 `pnpm feature:check org` |
| 조직 화면 어댑터 | `apps/web/app/(app)/org`, `admin/{settings,businesses,org,members,positions}`는 `features/org/src/ui/pages/`를 내보내는 한 줄 어댑터 |
| 조직 스키마·트리거 | `packages/db/src/schema/org.ts`, `migrations/0003_org_permission.sql`, `0004_org_rls_triggers.sql`, 시드 `features/account/src/seed/seed-org.ts` |
| DB 스키마·클라이언트 | `packages/db/src/schema/`, `src/client.ts` |
| 마이그레이션 SQL / 실행 | `packages/db/migrations/`, `src/migrate.ts`(import 경로 `@fmerp/db/migrate`) |
| S3 어댑터 (write-once 포함) | `packages/storage/src/object-storage.ts` |
| 인증·계정 — **`features/account/`** | `src/service/`(`auth.ts` Better Auth 설정·`authOf`, `accounts.ts` 계정·초대, `pin.ts`, `me.ts`, `dev-login.ts`, `test-accounts.ts`), `src/seed/`(시드 계정·시험 조직), `src/api/`(`routes.ts` 진입점), `src/ui/`(로그인·초대·온보딩·내 정보), 공통 세션 기본기는 `shared/src/authz/`(`errors`·`session-guard`·`membership`·`reauth`). 검사 `pnpm feature:check account` |
| 감사 로그 기록 | `packages/audit/src/` (`recordAudit`, `computeAuditDiff`) |
| 감사 조회·타임라인·월간 점검 (M6) — **`features/audit/`** | `src/domain/`(`audit-review.ts`·`audit-timeline.ts`), `src/service/`(`logs.ts`·`timeline.ts`), `src/api/routes.ts`, `src/ui/{pages,components,queries.ts}`(`audit-trail.tsx`는 결재 상세에 슬롯으로 끼움), 테스트 `tests/`, `feature.map.yaml`. 검사 `pnpm feature:check audit` |
| 세션·PIN 정책 (순수 함수) | `shared/src/domain/session-policy.ts`, `pin-policy.ts` |
| 스키마 | `packages/db/src/schema/` (`auth.ts`, `tenant.ts`, `audit.ts`, `columns.ts`) |
| DB 권한·RLS | `packages/db/migrations/0002_grants_rls.sql` |
| 로컬 개발·테스트 서비스 | `docker-compose.dev.yml`, DB 계정 생성 `docker/postgres/initdb/01-roles.sh` |
| 테스트 설정 | `vitest.config.ts`(unit·integration 프로젝트), `packages/*/test/global-setup.ts`, 테스트 DB 초기화 `packages/db/test/reset-test-db.ts`, `apps/web/playwright.config.ts`, `apps/web/e2e/`(`test-env.ts`, `global-setup.ts`) |
| 통합 테스트 로그인 헬퍼 / M1 통합 테스트 | `shared/src/testing/test-client.ts`(앱은 `apps/web/server/test-support.ts`가 vitest setupFiles로 주입) / `apps/web/server/m1.int.test.ts` |
| 린트·Git hook·커밋 규칙 | `biome.json`(core import 제한 포함), `lefthook.yml`, `commitlint.config.mjs` |
| CI | `.github/workflows/ci.yml` |
| Claude hook·권한 | `.claude/settings.json`, `.claude/hooks/format-file.mjs` |
| 덤프·내보내기·복구 (M7) — **`features/backup/`** | `src/service/`(`dump.ts` 덤프, `export.ts` 계정 ZIP, `reindex.ts` 색인 재구성, `rehearse.ts` 복원·리허설, `age.ts` 암호화, `verify.ts` 패키지 검증, `system-backups.ts`·`account-export.ts` API 서비스), `src/domain/`(`backup.ts`·`doc-number-parse.ts` 순수 규칙) |
| 덤프·내보내기 API·화면 | `features/backup/src/api/`(`routes.ts` 진입점, `system-routes.ts`, `export-routes.ts`, `guards.ts`), `src/ui/{pages,queries.ts}` (`app/(app)/system/backups`·`admin/backups`는 어댑터) |
| 백업 worker·운영자 CLI | `features/backup/src/jobs/{jobs,config}.ts`(스케줄·요청 처리·설정), `src/operator.ts`, CLI는 합성 루트 `apps/worker/src/cli/{dump,restore,rehearse,reindex}.ts` (`pnpm backup:*`). 검사 `pnpm feature:check backup` |
| 완료 PDF·패키지 (M5) — **`features/completion/`** | `src/service/`(`generate.ts` 패키지 생성, `load.ts`, `pdf-html.ts`, `package-download.ts`), `src/api/routes.ts`, `src/jobs/{jobs,render,fonts}.ts`, `src/ui/components/completion-files.tsx`(결재 상세에 슬롯으로 끼움), 형식은 공통 소유 `packages/core/src/completion-package.ts`. 검사 `pnpm feature:check completion` |
| 알림 (M8) — **`features/notification/`** (기능 구조 시범, [계획 12장](plan/2026-10-06-feature-architecture-refactor.md)) | `src/domain/notification-rules.ts`(이벤트→수신자·문구), `src/service/`(`consume.ts` 이벤트→알림, `send.ts` 텔레그램 발송, `link.ts` 연결 토큰·`/start`, `receiver.ts` 폴링·웹훅 어댑터, `telegram-api.ts`, `alerts.ts` 운영 알림, `in-app.ts`·`telegram.ts` API 서비스), `src/api/routes.ts`, `src/jobs/jobs.ts`, `src/ui/{pages,components,queries.ts}`, 테스트 `tests/`, 지도 `feature.map.yaml`. Next 어댑터 `apps/web/app/(app)/{notifications,system/telegram,me}/page.tsx`, 스키마 `packages/db/src/schema/notification.ts`, `migrations/0018~0021`. 검사 `pnpm feature:check notification` |
| 구조 검사 도구 (기능 구조 전환) | `tools/src/`(`feature-assignment.ts` 배정표, `gates/` 래칫 게이트, `cli/arch-check·guard·boundaries·run-gate·quality-report`), 설정 `.dependency-cruiser.cjs`·`knip.json`·`tsconfig.depcruise.json`·`biome.boundaries.json`(생성), 기준선 `tools/baselines/`, 명령 `pnpm arch:check`·`arch:guard`·`verify`, 파일 이동+import 자동 수정 `pnpm arch:move` |
| 공통 영역 (기능 구조 전환) | `shared/src/`(`server/` 기반, `authz/`, `ui/`, `lib/`) — 이용 `@fmerp/shared/*`. `packages/db·audit·storage`도 공통 영역으로 취급 |
| 덤프·내보내기 스키마 | `packages/db/src/schema/backup.ts`, `migrations/0015_backup_tables.sql`, `0016_backup_rls_roles.sql` |

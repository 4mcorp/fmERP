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
| 로그인, 세션, 결재 PIN, 개인정보 | [rules/security.md](rules/security.md) | `better-auth-best-practices`, `better-auth-security-best-practices` | PRD 5.1·6.3·6.4 | `auth`, `security` |
| 결재 엔진 (기안·결재선·처리·위임·채번) | [rules/architecture.md](rules/architecture.md) 3장, [rules/database.md](rules/database.md) 2장, [rules/testing.md](rules/testing.md) | `tdd`, `domain-modeling` | PRD 5.4 | `approval` |
| 감사 기능, 감사 로그 | [rules/security.md](rules/security.md), [rules/database.md](rules/database.md) | – | PRD 5.5 (Must·Should만 구현, 10.3 제외 목록) | `audit` |
| 파일 업로드, S3, 완료 패키지, 덤프, 이관 | [rules/storage-backup.md](rules/storage-backup.md) | – | PRD 5.6·5.10, DEPLOYMENT_PLAN 2·7장 | `storage`, `backup` |
| 테스트 작성, 버그 수정 | [rules/testing.md](rules/testing.md) | `tdd`, `diagnosing-bugs`, `playwright-cli` | PRD 9장 | `test` |
| 패키지 추가·버전 변경 | [rules/dependencies.md](rules/dependencies.md) | `supply-chain-risk-auditor` | TECH_SPEC 2·3·5장 | `deps`, `pnpm` |
| 커밋, 브랜치 | [rules/git.md](rules/git.md) | `git-commit` | – | `git` |
| 보안 리뷰, 정적 분석 | [rules/security.md](rules/security.md) 5장 | `differential-review`, `semgrep` | PRD 6.3 | `security` |
| 배포, 서버, Docker, CI/CD | – | – | DEPLOYMENT_PLAN 4·6·8·9장 | `infra` |
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
| 서버 구성도·비용 | DEPLOYMENT_PLAN 4·5장 |
| Docker Compose 서비스 | DEPLOYMENT_PLAN 6.1 |
| DB 덤프·복구 절차·이관 절차 | DEPLOYMENT_PLAN 7장 |
| 서버 보안·모니터링·CI/CD | DEPLOYMENT_PLAN 8장 |
| 확정 결정 D1~D9 | TECH_SPEC 1장 |
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

---

## 6. 계획 (`docs/plan/`)
| 파일 | 상태 | 요약 |
|---|---|---|
| (없음) | | |

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
| (없음 — 골격 생성 시 PK 타입, 금액 타입, 에러 형식, 테스트 DB 방식을 결정 예정: rules/architecture.md 4장) | |

---

## 9. 코드 위치
| 대상 | 경로 |
|---|---|
| (프로젝트 골격 생성 후 작성) | |

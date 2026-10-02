# 4mERP 기술 스택 · Claude 스킬 · UI 컴포넌트 후보 비교 (검토용)

| 항목 | 내용 |
|---|---|
| 작성일 | 2026-10-03 |
| 상태 | **결정 완료 (2026-10-03)** — D1~D9 모두 제안안으로 확정. 확정 내용은 [TECH_SPEC.md](./TECH_SPEC.md)를 참조하세요. 아래는 비교 기록으로 남겨 둡니다. |
| 조사 방법 | npm 레지스트리에서 최신 버전과 peer 의존성 조회, endoflife.date에서 지원 주기 확인, GitHub API에서 스타 수 확인, skills.sh 설치 수 확인 (모두 2026-10-03 기준) |

---

## 0. 요약

- **PRD의 Must·Should 범위는 모두 개발할 수 있습니다.** 다만 **양식 빌더**와 **결재 엔진**은 직접 만들어야 하는 큰 덩어리입니다. **HWP 미리보기(P1)** 는 오픈소스로 처리하기 어려워 제외하거나 외부 서비스를 써야 합니다(1장).
- 버전을 고르다가 **자동으로 조정한 항목**이 있습니다(2.2절).
  - TypeScript: 7.0 → **6.0**
  - Vitest: 5.0 → **4.1**
  - Drizzle: 1.0 RC → **0.45**
  - Node: 26 → **24 LTS**
- 결정이 필요한 항목은 5장에 모았습니다.

---

## 1. PRD 기준 개발 가능성 판단

| PRD 영역 | 구현 방법 | 난이도 | 판단 |
|---|---|:-:|---|
| Google·Naver 로그인 (AUTH-001~004) | Better Auth **내장 공급자**(Google, Naver 모두 공식 지원) | 하 | ✅ |
| 결재 PIN (AUTH-009) | 자체 구현 + Argon2id (`@node-rs/argon2`) | 하 | ✅ |
| 패스키 (AUTH-010, P1) | `@better-auth/passkey` 플러그인 | 하 | ✅ |
| 계정·사업자·부서 트리 (ORG) | PostgreSQL `ltree` 또는 경로 컬럼 + 트리거로 뎁스 검증 | 중 | ✅ |
| 조직도 UI | 트리: `@headless-tree/react` / 조직도 차트: `@xyflow/react` | 중 | ✅ |
| 테넌트 격리 (PERM-002) | Drizzle의 `pgPolicy`(RLS) + 트랜잭션마다 `SET LOCAL app.account_id` | 중 | ✅ |
| **양식 빌더 (APV-001~007)** | 자체 구현: JSON 스키마 → react-hook-form 렌더러, 필드 배치는 `@dnd-kit` | **상** | ⚠️ 가장 큰 커스텀 영역입니다. MVP에서는 "필드 나열 + 표 + 리치 텍스트"로 제한하고 자유 배치 레이아웃은 빼기를 권장 |
| **결재 엔진 (APV-030~064)** | `packages/core`에 순수 TypeScript 상태 머신(병렬 합의, 전결, 대결, 후결), 단위 테스트 위주로 개발 | **상** | ✅ 외부 라이브러리 없이 직접 구현. TDD 스킬 활용 권장 |
| 문서번호 채번 | SQL 행 잠금 (`SELECT … FOR UPDATE`) | 하 | ✅ |
| 리치 텍스트 본문 | Tiptap 3 | 중 | ✅ |
| 결재 PDF | Playwright `page.pdf()` + 한글 폰트(Pretendard) | 중 | ✅ |
| 첨부·S3 패키지 | `@aws-sdk/client-s3` + 서명 URL | 하 | ✅ |
| 클라이언트 자동 저장 (BAK-001) | Dexie (IndexedDB) | 하 | ✅ |
| 작업 큐·예약 (일일 덤프 등) | pg-boss 12 | 하 | ✅ |
| DB 덤프 + 암호화 | worker 컨테이너에서 `pg_dump` + `age` | 하 | ✅ |
| 계정 내보내기 ZIP | `archiver`(스트리밍). 암호화는 age 사용 | 중 | ✅ ZIP 자체 비밀번호(AES) 라이브러리는 유지보수가 약해 age로 대체 권장 |
| 감사 로그 (AUD Must·Should) | API 미들웨어 + DB 권한(INSERT·SELECT만 허용) + diff는 `microdiff` | 중 | ✅ |
| 문서 검색 (APV-082) | PostgreSQL 기본 전문 검색은 **한국어 형태소 분석을 지원하지 않음** → `pg_trgm` 부분 일치 검색 | 중 | ✅ 100명 규모면 충분 |
| 엑셀 내보내기 | `exceljs` | 하 | ✅ |
| 인앱 실시간 알림 | Hono SSE (또는 30초 폴링) | 하 | ✅ |
| 이메일 | AWS SES v2 SDK | 하 | ✅ |
| 웹 푸시·PWA (P1) | `serwist` + `web-push` | 중 | ✅ |
| 오피스 문서 미리보기 (P1) | LibreOffice headless로 PDF 변환 (이미지 약 +500MB) | 중 | ⚠️ 서버 메모리 여유 확인 필요 |
| **HWP 미리보기 (P1)** | 오픈소스 변환 품질이 낮음 | **상** | ❌ 제외 또는 외부 변환 API 권장 (PRD Q8) |
| OpenAPI (API-001) | `@hono/zod-openapi` | 하 | ✅ |

---

## 2. 기술 스택 후보와 버전

### 2.1 확정 제안 버전 (stable / LTS 기준)

| 영역 | 패키지 | 고정 버전 | 최신 버전 | 근거 |
|---|---|---|---|---|
| 런타임 | **Node.js** | **24.x LTS** (24.21) | 26.10 | 24는 2028-04까지 지원. 26은 2026-10-28에 LTS로 전환될 예정이라, 전환 후 안정화되면 2027년 상반기에 검토 |
| 패키지 매니저 | pnpm | **11.x** (11.28) | 12.8 | 12는 2026-08 출시라 보류 |
| 언어 | **TypeScript** | **6.0.x** (6.0.3) | 7.0.2 | ⚙️ 자동 조정: 아래 2.2절 참조 |
| DB | **PostgreSQL** | **18.x** (18.6) | 18.6 | 출시 1년, 2030-11까지 지원. 보수적으로 가려면 17.x(2029-11까지) |
| 웹 | **Next.js** | **16.3.x** | 16.3.8 | 현재 Active LTS. 15는 2026-10-21에 지원 종료 |
| UI 런타임 | React / React DOM | 19.3.x | 19.3.0 | Next 16 peer `^19` ✓ |
| 스타일 | Tailwind CSS | 4.3.x | 4.3.3 | shadcn 생태계 기준 |
| 컴포넌트 | shadcn CLI | 4.x | 4.21.1 | 4장 참조 |
| API | **Hono** | 4.13.x | 4.13.12 | |
| | @hono/node-server | 2.1.x | 2.1.3 | peer `hono ^4` ✓, Node ≥20 ✓ |
| | @hono/zod-openapi | 1.6.x | 1.6.3 | peer `hono >=4.10`, `zod ^4` ✓ |
| 검증 | Zod | 4.6.x | 4.6.5 | Better Auth가 `^4.5.4`를 요구 ✓ |
| 인증 | **Better Auth** | 1.7.x | 1.7.7 | peer: `next ^16` ✓, `drizzle-orm ^0.45.2` ✓, `pg ^8` ✓. `@better-auth/passkey`도 같은 버전으로 맞춤 |
| ORM | **Drizzle ORM** / drizzle-kit | **0.45.x** / 0.31.x | 1.0.0-rc.4 | ⚙️ 1.0은 아직 RC이므로 0.45로 고정 |
| DB 드라이버 | pg (node-postgres) | 8.23.x | 8.23.1 | Drizzle, pg-boss, Better Auth가 **같은 드라이버를 공유** |
| 작업 큐 | pg-boss | 12.x | 12.35.1 | Node ≥22.12 요구 ✓ |
| 서버 상태 | TanStack Query | 5.x | 5.104.1 | |
| 표 | TanStack Table | 9.2.x | 9.2.4 | v9는 2026-08 출시. 표 컴포넌트(tablecn)가 v9 기준이라 맞춤. 문제가 생기면 8.21로 후퇴 |
| 폼 | react-hook-form / @hookform/resolvers | 7.89.x / 5.9.x | – | resolvers 5가 Zod 4 지원 ✓ |
| 에디터 | Tiptap | 3.x | 3.31.4 | |
| 로컬 저장 | Dexie | 4.4.x | 4.4.6 | |
| 스토리지 | @aws-sdk/client-s3 (+ s3-request-presigner) | 3.x | – | R2, S3, NCP 공통 |
| PDF·E2E | Playwright | 1.63.x | 1.63.0 | Docker 이미지도 같은 버전(`playwright:v1.63.0`)으로 고정 |
| 단위 테스트 | **Vitest** | **4.1.x** | 5.0.3 | ⚙️ 5.0은 2026-09-03 출시라 보류 |
| 린트·포맷 | Biome **또는** ESLint 10 + typescript-eslint 8.71 | 2.5.x / – | – | 5장 결정 항목 |

### 2.2 자동 조정 내역 (의존성 충돌·안정성)

| 항목 | 최신 버전 | 조정 결과 | 이유 |
|---|---|---|---|
| TypeScript | 7.0.2 | **6.0.3** | `typescript-eslint@8.71`의 peer 범위가 `typescript >=4.8.4 <6.1.0`이라 7.0을 지원하지 않습니다. 또 7.0은 Go로 다시 작성된 첫 메이저(2026-07 출시)라 Next 빌드 등 도구 호환성을 검증할 기간이 필요합니다. |
| Vitest | 5.0.3 | **4.1.x** | 5.0은 출시 1개월째입니다. 4.1은 Node 24와 Vite 7을 지원하는 안정 라인입니다. |
| Drizzle | 1.0.0-rc | **0.45.x** | 정식(latest) 태그가 0.45입니다. Better Auth peer가 0.45와 1.0을 모두 허용하므로 나중에 올리기 쉽습니다. |
| Prisma (대안) | 8.0.0-rc | – | `latest` 태그가 RC를 가리키는 등 배포 상태가 불안정해 Drizzle을 권장합니다. |
| Node | 26.10 | **24 LTS** | 26은 아직 Current(LTS 아님)입니다. pg-boss(≥22.12), Vitest 4, ESLint 10, Next 16 요구사항을 모두 만족합니다. |
| Next.js | 15 사용 시 | **16** | 15는 2026-10-21에 지원이 끝납니다. |

### 2.3 호환성 유지 방법 (자동화)
- 루트 `package.json`에 `engines.node: ">=24 <25"`와 `packageManager: "pnpm@11.x"`를 두고, `.nvmrc`에 `24`를 적습니다.
- `.npmrc`에 `strict-peer-dependencies=true`를 설정합니다. **peer 충돌이 있으면 설치가 실패**하므로 CI에서 바로 잡힙니다.
- **Renovate**로 버전을 관리합니다.
  - 그룹 단위 업데이트(Better Auth 계열, TanStack 계열, Playwright npm·Docker 이미지 동기화)
  - 메이저 업데이트는 수동 승인
  - 출시 후 14일 동안 대기(`minimumReleaseAge`)
- 확정되면 실제로 `pnpm install`을 해서 peer 경고가 0건인지 검증한 뒤 lockfile을 커밋합니다.

### 2.4 애플리케이션 구성 후보
| 후보 | 구성 | 장점 | 단점 |
|---|---|---|---|
| **A. Next 안에 Hono 탑재 (권장)** | `apps/web`(Next 16, `/api/*`는 Hono 라우트 핸들러) + `apps/worker` | 컨테이너가 하나 줄어 100명 규모에 적합. 배포가 단순함. Hono 코드라 나중에 분리하기 쉬움 | 웹과 API가 함께 재시작됨 |
| B. API 분리 | `apps/web` + `apps/api`(Hono 단독) + `apps/worker` | 역할 분리가 명확 | 컨테이너·배포 대상이 늘어남 |

---

## 3. Claude 스킬 후보

**선정 기준:** GitHub 스타 수, skills.sh 설치 수, 공식(벤더) 여부, PRD와의 관련성. 스킬끼리 역할이 겹치면 충돌하므로 **영역마다 하나**만 고르는 것을 원칙으로 합니다.

### 3.1 개발 방법론 (택 1 권장)
| 후보 | 지표 | 내용 | 평가 |
|---|---|---|---|
| **mattpocock/skills** (개별 선택) | ★274k, `grill-me` 130만·`tdd` 100만·`improve-codebase-architecture` 100만·`domain-modeling` 74만 설치 | 요구사항 심문(grill-me), TDD, 도메인 모델링, 버그 진단 등을 하나씩 골라 설치 | **권장.** 결재 엔진처럼 도메인이 복잡한 영역에 `domain-modeling`과 `tdd`가 잘 맞음. 필요한 것만 골라 쓸 수 있어 가벼움 |
| obra/superpowers | ★294k | 브레인스토밍 → 계획 → TDD → 리뷰까지 강제하는 전체 방법론 프레임워크 | 강력하지만 무겁고 작업 방식을 강하게 고정함. 위 후보와 동시 사용은 비권장 |

### 3.2 프런트엔드 · 디자인
| 후보 | 지표 | 내용 | 평가 |
|---|---|---|---|
| **shadcn/ui 공식 `shadcn` 스킬** (+ shadcn MCP) | ★125k (shadcn-ui/ui), 27만 설치 | shadcn 컴포넌트 사용 규칙, 레지스트리 검색·설치 | **권장** (4장에서 shadcn을 선택할 때) |
| **vercel-labs/agent-skills: `vercel-react-best-practices`** | ★31.8k, 77만 설치 | React·Next.js 성능 규칙 | **권장** |
| **vercel-labs/agent-skills: `web-design-guidelines`** | 69만 설치 | 접근성·UX 규칙 100여 개로 UI 점검 | **권장.** PRD NFR-U03(KWCAG) 대응 |
| anthropics/skills: `frontend-design` | ★179k, 95만 설치 | 뻔한 AI 디자인을 피하고 의도가 있는 디자인을 하도록 유도 | 선택. 마케팅성 화면에 강하고, ERP 관리 화면에는 효과가 제한적 |
| vercel-labs/agent-skills: `vercel-composition-patterns` | 37만 설치 | 컴포넌트 합성 패턴 | 선택 |
| pbakaus/impeccable | ★74k, 31만 설치 | 디자인 언어 시스템 | 비권장. frontend-design과 겹침 |
| emilkowalski/skills | ★42.8k | 애니메이션·인터랙션 디자인 | 비권장. ERP와 관련성 낮음 |

### 3.3 백엔드 · DB · 인증
| 후보 | 지표 | 내용 | 평가 |
|---|---|---|---|
| **supabase/agent-skills: `supabase-postgres-best-practices`** | 43만 설치 (repo ★2.7k) | 인덱스, RLS, 스키마 설계 등 Postgres 일반 모범 사례 | **권장.** Supabase를 쓰지 않아도 Postgres 규칙으로 유효함 |
| **better-auth/skills** (공식) | ★222 | Better Auth 설정·보안 스킬 | **조건부 권장.** 스타 수는 낮지만 **벤더 공식**이고 버전 변경을 가장 빨리 반영함 |
| Drizzle 관련 커뮤니티 스킬 | 레퍼런스 적음 | – | 비권장. 대신 Drizzle 공식 문서(llms.txt)를 참조 |
| honojs/skills (공식) | ★10 | Hono 공식 스킬 | 비권장 (레퍼런스 부족). 필요하면 나중에 다시 검토 |

### 3.4 테스트 · 보안 · 도구
| 후보 | 지표 | 내용 | 평가 |
|---|---|---|---|
| **microsoft/playwright-cli** | ★13.7k | Playwright 기반 브라우저 조작·테스트 코드 생성 (에이전트용 스킬 포함) | **권장.** 이미 Playwright를 쓰므로 도구가 겹치지 않음 |
| vercel-labs/agent-browser | ★43.5k, 100만 설치 | 에이전트용 브라우저 자동화 CLI | 대안. 위 후보와 택 1 |
| anthropics/skills: `webapp-testing` | 공식 | Playwright로 웹앱 검증 | 대안 |
| **trailofbits/skills** | ★7.3k | CodeQL·Semgrep 기반 보안 분석 | **권장.** 인증, 개인정보, 감사 로그 코드 점검용 |
| vercel-labs/skills: `find-skills` | ★33k, 370만 설치 (1위) | 스킬 검색·설치 CLI (`npx skills`) | **권장 (도구용).** 스킬 설치와 관리에 사용 |

### 3.5 권장 조합 (안)
```
방법론   : mattpocock/skills → grill-me, tdd, domain-modeling, diagnosing-bugs
프런트   : shadcn (공식) + vercel-react-best-practices + web-design-guidelines
DB·인증  : supabase-postgres-best-practices + better-auth (공식)
테스트   : microsoft/playwright-cli
보안     : trailofbits/skills (필요한 스킬만)
관리 도구 : vercel-labs/skills (find-skills)
```
프로젝트 범위(`.claude/skills/`)에 설치해 다른 개발자와 공유합니다.

---

## 4. UI 컴포넌트 소스 후보 (에이전트 연동)

| 후보 | 지표 | 에이전트 연동 | ERP 적합성 | 비용 | 평가 |
|---|---|---|---|---|---|
| **A. shadcn/ui 레지스트리** | ★125k | **공식 MCP 서버**(`npx shadcn mcp`) + **공식 스킬**. 서드파티 레지스트리도 같은 MCP로 검색·설치 | 폼, 다이얼로그, 날짜 선택(한국어 로케일) 등 기본기 충분. 표·트리는 아래 확장 레지스트리로 보완 | 무료 | **권장.** AI가 가장 잘 아는 컴포넌트 체계이고, 코드가 프로젝트로 복사되어 수정이 자유로움 |
| ├ tablecn (shadcn 확장) | ★6.3k | shadcn 레지스트리로 설치 | **데이터 그리드**(정렬, 필터, 페이지네이션, 고정 열) — 문서함·감사 로그 화면에 적합 | 무료 | A와 함께 권장 |
| ├ coss ui (Cal.com, 구 Origin UI) | ★10.6k | shadcn 레지스트리 호환, Base UI 기반 | 입력·폼 계열 컴포넌트가 다양하고 완성도 높음 | 무료 | 선택 |
| ├ ReUI | ★3.6k | shadcn 레지스트리 | 관리 화면 패턴 1,000여 개 | 무료 | 선택 |
| └ tweakcn | ★10.4k | 테마 편집기 → CSS 변수로 내보내기 | 브랜드 색·다크 모드 테마 제작 | 무료 | 선택 (테마 제작용) |
| B. 21st.dev | 21st MCP ★6k | MCP로 커뮤니티 컴포넌트를 검색·생성 (shadcn CLI 호환) | 랜딩 페이지·화려한 컴포넌트 중심이라 관리 화면에는 효용이 낮음 | AI 생성은 크레딧 과금 (비싸다는 평이 있음) | 보조 수단으로만 사용 |
| C. Ant Design v6 | ★99.7k | **공식 MCP**(`@ant-design/cli` 6.3.5 이상, `antd mcp`) | **관리 화면용 위젯이 가장 풍부함**(Table 고정 열, Tree, TreeSelect, Transfer, Form, Upload, 한국어 로케일) | 무료 | 대안. 바로 쓸 수 있는 위젯이 많지만 디자인 자유도가 낮고 Tailwind와 섞기 어려우며 번들이 큼. 에이전트 스킬 생태계도 작음 |
| D. Mantine | ★31.8k | 공식 MCP·스킬 확인되지 않음 | 폼·날짜·알림 컴포넌트 우수 | 무료 | 비권장 (에이전트 연동 근거 부족) |
| E. Magic UI | ★22.4k | shadcn 레지스트리 | 애니메이션 중심 | 무료 | 비권장 (ERP와 관련성 낮음) |

**제안:** **A(shadcn MCP + 스킬)를 기본**으로 하고 tablecn을 추가합니다. 테마는 tweakcn으로 만들고, 21st.dev는 특정 컴포넌트가 필요할 때만 씁니다.
반대로 "디자인보다 기능 위젯을 빨리 갖추는 것"이 최우선이면 C(Ant Design)가 대안입니다.

---

## 5. 결정 요청 항목

| # | 항목 | 선택지 | 제안 |
|---|---|---|---|
| D1 | UI 컴포넌트 기반 | A. shadcn (+ tablecn) / C. Ant Design | **A** |
| D2 | shadcn 프리미티브 | Radix UI / Base UI | 레퍼런스가 많은 **Radix**. 단, coss ui를 쓸 계획이면 Base UI |
| D3 | 개발 방법론 스킬 | mattpocock(개별 선택) / superpowers | **mattpocock** |
| D4 | 브라우저 테스트 스킬 | playwright-cli / agent-browser / webapp-testing | **playwright-cli** |
| D5 | 린트·포맷 | Biome / ESLint + Prettier | **Biome** (설정 단순, 의존성 적음, TS peer 제약 없음) |
| D6 | 앱 구성 | A. Next 안에 Hono / B. API 분리 | **A** (배포 계획서 6.1절도 이에 맞게 수정) |
| D7 | PostgreSQL | 18.x / 17.x | **18.x** |
| D8 | 양식 빌더 MVP 범위 | 필드 나열 + 표 + 리치 텍스트 / 자유 배치 레이아웃 | **필드 나열 + 표 + 리치 텍스트** |
| D9 | HWP 미리보기 | 제외 / 외부 변환 API | **제외** |

---

## 6. 출처
- 스킬 설치 순위: [skills.sh](https://skills.sh), [Firecrawl – Best Claude Code Skills](https://www.firecrawl.dev/blog/best-claude-code-skills), [Claude Marketplaces 비교](https://www.gradually.ai/en/claude-marketplaces/)
- 스타 수: GitHub API (anthropics/skills, mattpocock/skills, obra/superpowers, vercel-labs/agent-skills, vercel-labs/skills, shadcn-ui/ui, supabase/agent-skills, better-auth/skills, microsoft/playwright-cli, trailofbits/skills, sadmann7/tablecn, cosscom/coss, jnsahaj/tweakcn, 21st-dev/magic-mcp, ant-design/ant-design, mantinedev/mantine 등)
- shadcn MCP: [ui.shadcn.com/docs/mcp](https://ui.shadcn.com/docs/mcp)
- Ant Design MCP: [ant.design/docs/react/mcp](https://ant.design/docs/react/mcp)
- 21st.dev MCP: [21st.dev blog](https://21st.dev/blog/mcp-ui-components)
- Better Auth Naver 공급자: better-auth 저장소 `docs/content/docs/authentication/naver.mdx`
- 지원 주기: endoflife.date (Node.js, PostgreSQL, Next.js, pnpm, React)

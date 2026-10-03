---
title: M2 조직·권한 (사업자·부서 트리·직위·소속·역할)
date: 2026-10-03
status: done
tags: [db, api, ui, auth, audit, test]
related: [docs/plan/2026-10-03-mvp-roadmap.md, docs/plan/2026-10-03-m1-security-review.md, docs/rules/database.md, docs/rules/api.md, docs/rules/frontend.md, docs/rules/security.md, docs/adr/0005-better-auth-organization-as-tenant.md]
---

## 목표
M1에서 만든 계정(테넌트)·구성원 위에 **사업자 → 부서 트리 → 소속(겸직) → 역할(범위)** 을 올려, 이후 결재선·문서 열람 권한(M3~M5)이 기댈 조직 데이터와 권한 판정 함수를 확정한다.
완료 기준(PRD Phase 0): 조직도를 구성하고 구성원을 소속·역할과 함께 초대할 수 있다. 수용 기준 S2(부서 뎁스 제한)를 통과한다.

## 범위
- **포함 (P0):** ORG-001~005, ORG-010~017, ORG-030~036, PERM-001, ADM-001, ADM-002, ADM-003
- **함께 처리:** M1 후속 FU-3(소유자 동시 비활성화 경쟁 조건 → 구성원 행 잠금), M1 초대 `preset`(사업자·부서·직위)의 실제 적용
- **제외:** ORG-006·018~020·037(P1·P2), PERM-003 문서 열람 권한(M5), 결재 진행 문서 관련 검사의 실제 연결(아래 Q3)

## 사전 확인 — 적용할 트러블슈팅
| ts | 적용 |
|---|---|
| [pgboss-schema-permission](../ts/2026-10-03-pgboss-schema-permission.md) | 새 테이블 권한은 마이그레이션에서 `fmerp_app`·`fmerp_auth`별로 명시 부여 (database.md 3장) |
| [better-auth-integration](../ts/2026-10-03-better-auth-integration.md) | organization 플러그인 우회 경로는 `disabledPaths` 유지. 변경 후 m1 통합 테스트 실행 |
| [next-monorepo-env-and-bundling](../ts/2026-10-03-next-monorepo-env-and-bundling.md) | 공유 패키지 진입점에 Node 전용 코드 금지 |
| [e2e-dev-server](../ts/2026-10-03-e2e-dev-server.md) | E2E는 테스트 DB만, 상태 변경 흐름은 `@stateful`, 이동은 `toHaveURL`로 확인 |
| [vitest-globalsetup-env](../ts/2026-10-03-vitest-globalsetup-env.md), [biome-windows-spawn](../ts/2026-10-03-biome-windows-spawn.md), [python-escape](../ts/2026-10-03-python-escape-in-doc-edits.md) | 테스트 env는 `project.config.env`, lint EPERM은 재시도, 문서는 Edit로 |

## 설계

### 1. 데이터 모델 (PRD 7장 기준, 모두 `account_id` + RLS)
| 테이블 | 핵심 컬럼 | 제약 |
|---|---|---|
| `account` (확장) | `max_dept_depth` 1~5 기본 1, `allowed_domains text[]`, `timezone` 기본 Asia/Seoul, `locale` 기본 ko, `security_policy`에 재인증·첨부 정책 키 추가 | CHECK 1~5 |
| `business` | name, biz_reg_no(10자리), corp_reg_no, ceo_name, industry, address, phone, code(문서번호용), seal_key, active | UNIQUE(account_id, biz_reg_no), UNIQUE(account_id, code) |
| `department` | business_id, parent_id, depth, path, code, name, short_name, head_membership_id, sort, active, valid_from/to | UNIQUE(business_id, code), 트리거: `depth ≤ account.max_dept_depth`, 부모와 같은 사업자, 순환 금지 |
| `position` / `duty` | name, rank(직위만), active | UNIQUE(account_id, name) |
| `assignment` | membership_id, business_id, department_id, position_id, duty_id, is_primary, valid_from/to | **부분 유니크**: 구성원당 `is_primary` 1개(유효 소속 기준). 부서가 사업자에 속하는지 복합 FK 또는 트리거 |
| `assignment_history` | membership_id, 변경 전·후(jsonb), 발령일, 사유, 처리자 | append-only (INSERT·SELECT만) |
| `role_grant` | membership_id, role, scope_type(account·business·department), scope_id | UNIQUE(membership_id, role, scope_type, scope_id) |

- **부서 트리:** `ltree` 대신 **구체화 경로**(`path` = 조상 id를 `/`로 연결한 text)와 `depth` 컬럼을 쓴다. 확장 의존이 없고 `LIKE 'path/%'`로 하위 트리를 찾는다. 이동 시 하위 트리의 path·depth를 한 문장으로 갱신하고, 결과 최대 뎁스를 트리거가 검증한다. (Q1)
- **기본 소유자·관리자:** `membership.role`(owner·admin·member)은 그대로 둔다. 소유자·계정관리자는 암묵적으로 계정 범위이며 `role_grant`에 넣지 않는다.
- **`role_grant` 대상 역할:** 사업자관리자(business), 결재관리자(account·business), 감사인(account·business·department), 인사관리자(account·business). 결재관리자·감사인의 실제 권한은 M3·M6에서 사용하고, M2에서는 부여·조회·판정까지 만든다. (Q2)
- 직위 기본값 12개(ORG-030)는 계정 생성 시 자동 입력한다. 직책은 빈 상태로 시작한다.
- 모든 새 테이블: RLS 정책(0002 형식) + `fmerp_app` 권한 명시 부여. `assignment_history`·`role_grant` 변경은 감사 로그에도 남긴다.

### 2. 도메인 규칙 (`packages/core`, 순수 함수 · TDD)
| 모듈 | 내용 |
|---|---|
| `business-number.ts` | 사업자등록번호 체크섬 검증·정규화 (ORG-003, S1) |
| `department-tree.ts` | 생성·이동·뎁스 변경 가능 여부, 뎁스 초과 부서 목록 (ORG-011~013, S2) |
| `permissions.ts` | `can(actor, action, scope)` — 역할 + 범위(계정·사업자·부서+하위)로 권한 매트릭스(PRD 3.3) 판정. 범위 포함 관계는 부서 path로 계산 |
| `assignment.ts` | 주소속 1개 규칙, 겸직 기본 소속 선택, 발령 diff, **결재 시점 스냅샷 생성**(ORG-017, 사용은 M4) |

DB 트리거는 마지막 방어선이고, 사용자에게 보여 줄 오류 메시지·판정은 core가 만든다.

### 3. API (`/api`, 권한은 `can()` 한곳에서 판정)
| 경로 | PRD |
|---|---|
| `GET/PATCH /api/account/settings` (이름·허용 도메인·최대 뎁스·세션·재인증·첨부 정책) | ORG-001, ORG-012, ADM-001 |
| `GET/POST/PATCH /api/businesses`, 비활성화 `POST /api/businesses/:id/deactivate` | ORG-002~005 |
| `GET/POST/PATCH /api/departments`, 이동 `POST /api/departments/:id/move`, 폐지 `POST …/deactivate`, 삭제 `DELETE` | ORG-010~015 |
| `GET /api/org-chart` (트리 + 구성원 수), CSV `GET /api/departments/export`, `POST /api/departments/import` | ORG-016 |
| `GET/POST/PATCH /api/positions`, `/api/duties` | ORG-030·031 |
| `GET/PATCH /api/account/members/:userId` 확장 (사번·상태), `PUT /api/account/members/:userId/assignments` | ORG-032~035 |
| `GET/POST/DELETE /api/account/members/:userId/roles` | PERM-001, ADM-003 |
| `POST /api/account/invitations` 확장: `preset`(사업자·부서·직위·역할)을 검증해 저장, 수락 시 소속 생성 | AUTH-006, ORG-032 |

- 구성원 상태 변경·역할 부여는 `SELECT … FOR UPDATE`로 행을 잠가 마지막 소유자 보호의 경쟁 조건을 없앤다(FU-3).
- 모든 변경 요청은 `recordAudit()`로 기록한다(생성·수정·이동·폐지·발령·역할 부여·정책 변경). 권한 변경은 PRD 3.2 "모든 권한 변경은 감사 로그" 원칙에 따라 diff를 남긴다.

### 4. 화면 (관리 콘솔 `/admin/*`, 360px 모바일 가능)
| 경로 | 내용 |
|---|---|
| `/onboarding` (확장) | 새 회사 만들기 → **첫 사업자 등록 안내**(ORG-002) → 구성원 초대 안내 |
| `/admin/settings` | 계정 일반·허용 도메인·부서 최대 뎁스(낮출 때 초과 부서 목록 표시)·세션·재인증·첨부 정책 |
| `/admin/businesses` | 사업자 목록·등록·수정·비활성화·직인 이미지(서명 URL 방식은 M1과 동일) |
| `/admin/org` | 부서 트리 편집(드래그 이동, 뎁스 초과 시 생성 버튼 비활성화·안내), 조직도 차트 보기, 검색, 구성원 수, CSV 내보내기·가져오기 |
| `/admin/members` (확장) | 사번·상태, 소속(겸직·주소속) 편집, 발령 이력, 역할·범위 부여, 초대 시 프리셋 |
| `/admin/positions` | 직위·직책 마스터 |
| `/org` | 전 구성원용 조직도 조회·검색 (PRD IA "조직도") |

사이드 메뉴에 관리 콘솔을 역할별로 노출한다. 테이블은 tablecn 기반, 폼은 API와 같은 Zod 스키마.

### 5. 시드
`pnpm db:seed`를 확장한다: 포엠테스트(주)에 사업자 2개(체크섬 유효한 가짜 번호), 3단계 부서 트리(최대 뎁스 3), 직위 기본값, 직책, 구성원별 소속·겸직 1건, `role_grant` 샘플(사업자관리자·인사관리자·감사인·결재관리자). 다른회사(주)에는 격리 검증용 사업자 1개. 시드 계정·비밀번호는 기존처럼 `packages/auth/src/test-accounts.ts`에만 둔다.

## 단계
- [x] 1. 결정 Q1~Q6 확정, ADR 0006(조직·권한 모델: 구체화 경로, `role_grant`, 소유자·관리자 암묵 범위) 작성
- [x] 2. `packages/core` (TDD): 사업자번호, 부서 트리 규칙, `can()` 권한 판정, 소속·스냅샷
- [x] 3. DB: 스키마·마이그레이션(테이블, 트리거, RLS, 권한), 직위 기본값
- [x] 4. 서비스·API: 기능별로 추가(설정 → 사업자 → 부서 → 직위·직책 → 소속·발령 → 역할 → 초대 프리셋), 감사 로그 연결, FU-3 행 잠금
- [x] 5. 시드 확장
- [x] 6. 화면 (`shadcn`, `vercel-react-best-practices`), 완료 후 `web-design-guidelines`로 점검
- [x] 7. 테스트: 단위·통합·E2E (아래 완료 기준)
- [x] 8. 보안 리뷰(`differential-review`) — 권한 판정 우회, 범위 확대, 테넌트 격리 중심
- [x] 9. 문서: TECH_SPEC·INDEX·rules 갱신, ts(발생 시)

## 완료 기준
- [x] 단위: 사업자번호 체크섬, 뎁스 규칙(생성·이동·낮추기), 주소속 1개, `can()` 권한 매트릭스(역할×범위, 범위 밖 거부), 스냅샷
- [x] 통합:
  - **S2 시나리오:** 최대 3에서 4단계 생성 거부 → 2로 낮추기 거부(3단계 부서 목록 반환) → 하위 포함 이동으로 뎁스 4가 되면 거부
  - **DB 트리거:** API를 거치지 않은 직접 INSERT·UPDATE도 뎁스·사업자 불일치·순환을 거부
  - **중복:** 같은 계정에서 사업자등록번호·사업자 코드·부서 코드(사업자 안) 중복 거부, 체크섬 오류 거부
  - **주소속:** 구성원당 주소속 2개 거부, 겸직(다른 사업자·부서) 허용
  - **삭제·폐지:** 하위 부서·소속원이 있는 부서 삭제 거부(폐지만 가능)
  - **권한:** 사업자관리자는 자기 사업자 밖 부서·구성원 변경 거부, 일반 구성원은 관리 API 403, 부서 범위 감사인 역할은 범위 판정 통과·밖은 거부
  - **테넌트 격리:** 새 테이블 모두 다른 계정 조회 0행·교차 쓰기 거부(신규 테이블마다)
  - **불변:** `assignment_history` UPDATE·DELETE 거부
  - **경쟁 조건:** 소유자 두 명 동시 상호 비활성화 시 한 명은 남는다(FU-3)
  - **초대 프리셋:** 수락 시 지정한 사업자·부서·직위로 소속 생성, 범위 밖 프리셋 거부
  - **감사 로그:** 모든 변경 유형이 필수 항목과 diff로 기록
- [x] E2E(데스크톱·360px): 사업자 등록 → 부서 3단계 생성 → 뎁스 초과 안내 → 부서 이동 → 구성원 소속·겸직·역할 부여 → 조직도 조회
- [x] lint · typecheck · 전체 테스트 · `next build`

## 결정 필요
| # | 항목 | 제안 |
|---|---|---|
| Q1 | 부서 트리 구현 | 구체화 경로 text(`path`+`depth`). `ltree`는 확장·타입 매핑 비용 대비 이득이 작음 (사용자 100명 이하, 부서 수백 개 규모) |
| Q2 | 역할 모델 | `membership.role`(owner·admin·member) 유지 + 나머지 4개 역할은 `role_grant`(범위 포함). 소유자·관리자는 암묵적 계정 범위 |
| Q3 | 진행 중 결재 검사(ORG-005·015·036) | 결재 문서가 M4에야 생기므로 M2는 **검사 지점(인터페이스)만** 만들고 현재는 "없음"을 반환한다. 퇴사 시 결재 대기 이관 UI(ORG-036)는 M4 문서 도입 후 ADM-005와 함께 완성하고 로드맵에 반영한다 |
| Q4 | 휴대폰·프로필 항목(ORG-034) | 휴대폰은 M1의 `user` 프로필 항목을 그대로 쓴다(없으면 M2에서 추가). 조직 정보만 membership에 둔다 |
| Q5 | CSV 가져오기 범위 | 부서만(코드·이름·상위 코드·정렬). 구성원 일괄 가져오기는 하지 않는다(초대로 충분, 요청 시 idea로) |
| Q6 | 착수 순서 | 제안: 로드맵대로 M2부터. M3(결재 엔진, 순수 TS)를 M2와 병행하려면 별도 세션으로 분리 |

## 결정·변경 기록
- 2026-10-03: 초안 작성 (사용자 검토 대기)
- 2026-10-03: Q1~Q6 제안안대로 승인, 구현 시작
- 2026-10-03: 완료. 단위 75건·통합 95건·E2E 16건(데스크톱·360px), lint·typecheck·`next build` 통과. 보안 리뷰([m2-security-review](./2026-10-03-m2-security-review.md)) 후속 FU-6~10 기록. 휴대폰(ORG-034, Q4)은 `user` 프로필에 항목이 없어 이번에 추가하지 않았다(M2 이후 프로필 확장 때 처리). 부서 이동은 끌어놓기와 수정 화면의 상위 부서 선택 두 방식. 시드 계정 5명 추가(사업자관리·인사·감사인·결재관리·신입둘)

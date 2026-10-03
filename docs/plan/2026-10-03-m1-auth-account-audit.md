---
title: M1 계정·테넌트·감사 로그 기반 (개발용 테스트 로그인)
date: 2026-10-03
status: done
tags: [auth, db, audit, security, api, ui, test]
related: [docs/plan/2026-10-03-mvp-roadmap.md, docs/rules/security.md, docs/rules/database.md, docs/rules/api.md, docs/rules/frontend.md, docs/rules/testing.md]
---

## 목표
소셜 로그인 없이도 이후 모든 기능을 개발·테스트할 수 있는 **인증·계정 기반**을 만든다.
- Better Auth 세션 위에 **시드로 만든 테스트 계정 로그인**(개발·테스트 전용)을 제공한다.
- 회사 계정(테넌트) 생성, 초대 합류, 계정 전환, 세션 정책, 결재 PIN을 구현한다.
- 테넌트 격리(RLS)와 감사 로그(추가만 가능, 법정 기록 항목)를 이후 기능의 공통 기반으로 확정한다.

## 범위
- **포함 (P0):** AUTH-005(①새 계정 ②초대 합류), AUTH-006, AUTH-007, AUTH-008, AUTH-009, AUTH-013, AUTH-015, AUTH-016, PERM-002, AUD-020, AUD-021, AUD-022, AUD-024, AUD-027
- **M9로 이동 (사용자 결정 — 로그인은 마지막):** AUTH-001~004 (Google·Naver, 로그인 수단 연결·해제, 이메일 자동 병합 금지), AUTH-005 ③(도메인 자동 합류)
- **제외:** 사업자·부서·역할 범위(M2), 감사 로그 조회 화면·월간 점검(M6)

## 사전 확인 — 적용할 트러블슈팅
| ts | 적용 |
|---|---|
| [next-monorepo-env-and-bundling](../ts/2026-10-03-next-monorepo-env-and-bundling.md) | 새 환경 변수는 루트 `.env`. 공유 패키지 진입점에 Node 전용 경로 코드 금지 |
| [pgboss-schema-permission](../ts/2026-10-03-pgboss-schema-permission.md) | DB 역할 추가는 initdb + **기존 볼륨에 수동 반영**. 테이블 권한·RLS는 마이그레이션으로 |
| [s3-presigned-checksum](../ts/2026-10-03-s3-presigned-checksum.md) | 서명·도장 이미지 업로드는 `@fmerp/storage` 서명 URL 사용 |
| [vitest-globalsetup-env](../ts/2026-10-03-vitest-globalsetup-env.md) | 통합 테스트용 새 env는 `project.config.env` |
| [biome-windows-spawn](../ts/2026-10-03-biome-windows-spawn.md), [python-escape](../ts/2026-10-03-python-escape-in-doc-edits.md) | lint EPERM은 재시도, 문서는 Edit 도구로 |

## 설계

### 1. 개발용 테스트 로그인
| 항목 | 설계 |
|---|---|
| 방식 | Better Auth `emailAndPassword` (가입 `disableSignUp: true`) — **시드 계정만** 로그인 가능 |
| 활성 조건 | `DEV_TEST_LOGIN=true` **그리고** `NODE_ENV !== "production"`. 운영 모드에서 `DEV_TEST_LOGIN=true`면 **서버 기동 실패** (테스트로 보장) |
| 화면 | `/dev-login`: 시드 계정 목록에서 한 번 클릭으로 로그인. 비활성 시 404 |
| 시드 | `pnpm db:seed` — 테스트 계정·회사를 만든다. 계정 목록·비밀번호는 시드 파일(`packages/db/src/seed/test-accounts.ts`)에만 기록 |
| 테스트 | 통합 테스트·E2E는 같은 시드 계정으로 로그인 (Playwright `storageState`) |
| M9 전환 | Google·Naver 공급자 추가, 로그인 화면 교체, 운영에서 테스트 로그인 비활성 확인 |

**시드 테스트 계정** (도메인 `example.com` — 예약 도메인):
| 이메일 | 회사(계정) | 역할 | 용도 |
|---|---|---|---|
| owner@example.com | 포엠테스트(주) | owner | 소유자 흐름 |
| admin@example.com | 포엠테스트(주) | admin | 관리자 흐름(초대·비활성화) |
| member1@example.com, member2@example.com | 포엠테스트(주) | member | 일반 구성원 |
| owner-b@example.com | 다른회사(주) | owner | 테넌트 격리 검증 |
| multi@example.com | 두 회사 모두 | member | 계정 전환 |
| left@example.com | 포엠테스트(주) | member (status=left) | 비활성 구성원 차단 |

### 2. Better Auth 구성 (`packages/auth`)
- **organization 플러그인 = PRD의 "계정"** (Q1). 테이블 이름을 PRD 데이터 모델에 맞춘다.
  - organization → `account`, member → `membership`, 세션의 활성 계정 → `active_account_id`
  - Better Auth 기본 `account`(로그인 수단) 테이블 → `user_identity`
- **초대는 자체 구현:** Better Auth 초대는 초대 이메일과 로그인 이메일이 같아야 수락된다. PRD는 링크 초대(AUTH-006)도 요구하므로 자체 `invitation` 테이블(토큰·1회용·7일 만료·프리셋)을 쓰고, 수락 시 서버 API로 구성원을 추가한다.
- **ID:** `generateId: false` → DB 기본값 `uuidv7()` (ADR 0001)
- **세션:** 절대 만료 12시간(`expiresIn`). 유휴 2시간은 세션 추가 필드 `last_active_at` + API 미들웨어로 구현하고, 계정별 정책(`account.security_policy`)을 우선한다.
- **이벤트 기록:** `databaseHooks`(세션 생성·삭제) → 로그인·로그아웃 감사 로그. 로그인 실패는 `hooks`(after)에서 기록한다.

### 3. DB 역할과 RLS (Q2)
| 역할 | 용도 | RLS |
|---|---|---|
| `fmerp_migrator` | 마이그레이션 (기존) | 테이블 소유자 |
| `fmerp_app` | 앱 업무 데이터 | **적용** — `app.account_id`로 테넌트 격리 |
| **`fmerp_auth`** (신규) | Better Auth 전용 연결 (user·session·user_identity·verification·account·membership) | `BYPASSRLS` — 테넌트 설정 없이 구성원을 조회해야 하기 때문. 업무 테이블에는 권한 없음 |

### 4. 테이블 (마이그레이션)
`user`(+ signature_key, stamp_key), `session`(+ active_account_id, last_active_at, pin_verified_at), `user_identity`, `verification`, `account`(테넌트: name, slug, max_dept_depth 1~5 기본 1, security_policy), `membership`(+ status, employee_no, joined_at, left_at), `invitation`(자체: token_hash, role, preset, expires_at, used_at, created_by), `approval_pin`, `audit_log`(앱 계정 INSERT·SELECT만)

### 5. API (`/api`)
| 경로 | PRD |
|---|---|
| `/api/auth/*` (Better Auth) | – |
| `GET /api/dev/test-accounts` (테스트 로그인 활성 시만) | – |
| `GET/PATCH /api/me`, `POST /api/me/signature-upload` | AUTH-016 |
| `GET /api/me/sessions`, `DELETE /api/me/sessions/:id` | AUTH-008 |
| `GET /api/me/login-history` | AUTH-013 |
| `PUT /api/me/pin`, `POST /api/me/pin/verify` | AUTH-009 |
| `POST /api/accounts`, `POST /api/accounts/active` | AUTH-005 ①, AUTH-007 |
| `GET/POST /api/account/invitations`, `POST /api/invitations/accept` | AUTH-005 ②, AUTH-006 |
| `GET /api/account/members`, `PATCH /api/account/members/:userId` | AUTH-015 |

### 6. 감사 로그 (`packages/audit`, Q4)
- `recordAudit()` 하나로 기록하고, 필수 항목(AUD-021)은 타입으로 강제한다.
- diff는 `microdiff`로 계산하고, 민감 필드는 마스킹한다(AUD-027).
- M1 기록 대상: 로그인·로그아웃·실패, 계정 생성, 활성 계정 전환, 초대 생성·수락, 구성원 상태 변경, 세션 강제 종료, PIN 설정·검증 실패·잠금, 프로필 변경

### 7. 화면
`/dev-login`, `/onboarding`(새 회사 만들기·초대 코드), `/invite/[token]`, 앱 레이아웃(계정 전환·사용자 메뉴), `/me`(프로필·서명/도장, PIN, 세션, 로그인 이력), `/admin/members`(초대·구성원 비활성화, 최소)

## 단계
- [x] 1. ADR 0005: Better Auth organization = 계정(테넌트), 테이블 대응, `fmerp_auth` 역할, 자체 초대
- [x] 2. DB 역할 `fmerp_auth` 추가(initdb + 기존 볼륨 반영), 스키마·마이그레이션(권한·RLS 포함)
- [x] 3. `packages/auth`: Better Auth 설정, 테스트 로그인 가드, PIN 서비스; `packages/core`: 세션·PIN 정책 순수 함수
- [x] 4. `packages/audit`: `recordAudit()`, diff 마스킹. 로그인·로그아웃 기록은 Better Auth hooks 대신 `/api/auth/*` 마운트에서 처리(경로·결과를 한곳에서 판단)
- [x] 5. 시드 `pnpm db:seed` (테스트 계정·회사)
- [x] 6. API 미들웨어(세션·유휴 만료·테넌트·감사)와 라우트
- [x] 7. 화면
- [x] 8. 테스트: 단위·통합·E2E (아래 완료 기준)
- [x] 9. 보안 리뷰 (`better-auth-security-best-practices`, `differential-review`)
- [x] 10. 문서: TECH_SPEC, INDEX, rules, ts

## 완료 기준
- [x] 단위: 세션 정책(유휴·절대·계정별 우선), PIN 잠금(5회·15분), 감사 diff 마스킹
- [x] 통합 (31건, 보안 리뷰에서 비로그인 401·권한 상승·교차 출처·본문 크기 테스트 추가). 단, "운영 모드 기동 실패"는 단위 테스트와 실제 `next build`로 확인
  - **테스트 로그인 차단:** 운영 모드에서 테스트 로그인을 켜면 기동 실패
  - **가입 차단:** 시드에 없는 이메일로는 가입·로그인 불가
  - **테넌트 격리:** 계정 A 컨텍스트에서 계정 B의 구성원·초대·감사 로그가 조회되지 않음
  - **감사 로그 불변:** 앱 계정의 UPDATE·DELETE 거부
  - **초대:** 만료·재사용 거부, 수락 시 프리셋 역할로 구성원 추가
  - **비활성화:** 비활성 구성원은 해당 계정에 진입 불가, 세션 종료
  - **로그인 기록:** 로그인 성공·실패가 필수 항목과 함께 기록
- [x] E2E 10건(데스크톱·360px 모바일): 테스트 계정 로그인 → 초대 링크 생성 → 신규 사용자 수락 → 계정 전환 → PIN 설정·세션·로그인 이력, 비활성 구성원 차단. "새 회사 만들기"는 통합 테스트로 검증
- [x] lint · typecheck · 전체 테스트 · `next build`

## 결정
| # | 항목 | 결정 |
|---|---|---|
| Q1 | 테넌트 구현 | Better Auth organization 플러그인 (제안대로) |
| Q2 | Better Auth와 RLS | `fmerp_auth` 전용 역할(BYPASSRLS) (제안대로) |
| Q3 | 테스트 로그인 | 시드 계정 + 이메일·비밀번호(가입 차단), 개발·테스트에서만 활성 (사용자 결정으로 구체화) |
| Q4 | 감사 로그 위치 | `packages/audit` (제안대로) |
| Q5 | 추가 스킬 | `organization-best-practices` 설치 (제안대로) |
| Q6 | Naver 이메일 미제공 | M9에서 결정 |

## 결정·변경 기록
- 2026-10-03: 초안 작성 (소셜 로그인 포함)
- 2026-10-03: 사용자 결정 — 로그인은 마지막. 소셜 로그인을 M9로 옮기고 시드 테스트 계정 로그인을 추가. Q1~Q5는 제안안 적용
- 2026-10-03: Better Auth 초대는 이메일 일치를 요구해 링크 초대(AUTH-006)를 충족하지 못함 → 초대는 자체 구현
- 2026-10-03: 완료. 보안 리뷰([m1-security-review](./2026-10-03-m1-security-review.md)) 지적 SR-1~4 조치, 후속 FU-1~5 기록. 운영 빌드에서 레이아웃이 정적 렌더링되려던 버그 수정(`headers()` 우선 호출)

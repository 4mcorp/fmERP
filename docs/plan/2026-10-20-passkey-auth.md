---
title: passkey 인증 전환 (PK1a 백엔드 기반)
date: 2026-10-20
status: in-progress
tags: [auth, passkey, webauthn, account, migration]
related: [docs/rules/database.md, docs/rules/security.md, docs/ts/2026-10-03-better-auth-integration.md, docs/ts/2026-10-03-drizzle-composite-fk-migration-order.md]
---

## 목표
Google OAuth 로그인을 잠시 두고, passkey(WebAuthn)를 유일한 로그인 수단으로 쓸 수 있는 기반을 만든다.
PK1a에서 스키마·마이그레이션·RLS와 사전 등록·등록 토큰 서비스를 만든다.

## 현재 로그인 구성 (결정 기록)
- 백엔드 `createAuth`(`features/account/src/service/auth.ts`)에는 `socialProviders` 설정이 없다. Google 공급자는 구성되어 있지 않다.
- 로그인 화면의 Google 안내 문구는 "M9에서 구현"이라는 안내만 있다.
- 따라서 Google 비활성은 플래그 추가가 아니라 "현재 구성에 Google 공급자가 없음"을 기록하는 것으로 처리한다.
- 로그인 화면의 Google 안내 문구 제거는 PK2에서 한다.
- 복구 방법: 계정 복구는 관리자 초기화(PK1c)로 한다. 관리자가 사용자의 passkey를 지우고 새 등록 토큰을 발급한다.

## 범위
- 포함 (PK1a): `passkey` 표(Better Auth passkey 플러그인 모델과 필드 일치), `enrollment_token` 표(1회용·해시 저장·만료·폐기), RLS·GRANT, 사전 등록 사용자 생성, 등록 토큰 발급·검증·사용 처리(재사용 거부), 단위·통합 테스트.
- 제외 (후속):
  - PK1b: passkey 등록·로그인 라우트와 `createAuth`의 passkey 플러그인 연결.
  - PK1c: 관리자 초기화(passkey 전체 삭제·토큰 재발급·세션 폐기·감사·재인증).
  - PK2: 로그인 화면 UI, Google 안내 문구 제거.
- 의존성: `@better-auth/passkey`는 PK1a에서 추가하지 않는다. PK1b에서 `createAuth`에 플러그인을 연결할 때 `1.7.7` 정확 고정으로 추가한다. 지금 추가하면 import 없는 미사용 의존성으로 knip 게이트(`arch:check`)가 실패한다. `better-auth`는 `~1.7.7` 유지. 1.7.10 이상의 passkey는 `better-auth ^1.7.10`을 요구해 peer 충돌이 난다.

## 설계 결정
- `passkey`: 사용자 자격 증명이라 계정(RLS) 경계가 없다. `fmerp_auth`만 접근한다 (`user_identity`·`session`과 같은 방식). 앱 역할 접근은 권한 오류(42501)로 막는다.
- `enrollment_token`: 계정 데이터다. 발급은 `fmerp_app` + RLS(`withTenant`), 검증·사용 처리는 `fmerp_auth`(테넌트 지정 전 사용자가 쓰므로). 토큰 원문은 저장하지 않고 SHA-256 해시만 둔다.
- 재발급 시 같은 사용자의 미사용 토큰은 `revoked_at`으로 폐기한다. 이전 링크는 쓸 수 없다.
- 사용 처리는 조건부 UPDATE(`used_at IS NULL AND revoked_at IS NULL`)로 한 번만 성공한다.
- 사전 등록 사용자 생성은 `fmerp_app`에 `user`·`membership` INSERT 권한이 없어 `fmerp_auth` 연결로 한다.
- 발급은 감사 로그(`passkey.enrollment_issue`)에 남기고, 토큰 원문은 기록하지 않는다.

## 단계
- [x] 스키마 `passkey`·`enrollment_token` (`packages/db/src/schema/auth.ts`, `tenant.ts`)
- [x] 마이그레이션 `0024_passkey_enrollment.sql` (feature 태그, GRANT, RLS)
- [x] 도메인 규칙 `features/account/src/domain/enrollment.ts` (이메일·이름 정규화, 토큰 상태, 만료 시각)
- [x] 서비스 `features/account/src/service/enrollment.ts` (사전 등록, 발급, 검증, 사용 처리)
- [x] 단위 테스트 `tests/enrollment.test.ts`, 통합 테스트 `tests/enrollment.int.test.ts`
- [x] PK1b: `@better-auth/passkey@1.7.7` 추가, passkey 등록·로그인 라우트와 `createAuth` 연결 (구현: service/auth.ts 플러그인, service/passkey.ts, service/passkey-manage.ts, api/passkey-routes.ts)
- [x] PK1c: 관리자 초기화 (구현: service/passkey-reset.ts, api/account-routes.ts `POST /api/account/members/{userId}/passkey-reset`. 권한 `member.passkey_reset`은 소유자·관리자. PIN 재인증 후 passkey 전체 삭제·세션 종료·새 등록 토큰 발급, `passkey.admin_reset` 감사 기록)
- [x] PK1d: 관리자 사전 등록·등록 링크 재발급 (구현: api/account-routes.ts `POST /api/account/members`, `POST /api/account/members/{userId}/enrollment`, service/enrollment.ts `preRegisterMember`·`reissueMemberEnrollment`. 권한·재인증은 `member.passkey_reset`과 같다. 감사 `member.pre_register`·`member.enrollment_issue`)
- [ ] PK2: 로그인 화면·Google 안내 문구 제거

## 완료 기준
- `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:int`(변경 관련 파일), `pnpm arch:check` 위반 0
- 통합 테스트: 사전 등록 중복 방지, 토큰 원문 미저장, 재발급 시 이전 토큰 거부, 재사용 거부, 만료 거부, 다른 계정 RLS 격리, 앱 역할의 passkey 접근 거부

## 결정·변경 기록
- 2026-10-20: 카드 범위를 PK1a/1b/1c로 나눈다. 1a는 스키마·마이그레이션·서비스만 한다. 라우트와 관리자 초기화는 뒤 카드에서 한다.
- 2026-10-20: `@better-auth/passkey`는 PK1b로 옮겼다. PK1a에서 추가하면 knip(미사용 의존성) 게이트가 실패한다. 소유자 결정(knip 예외 추가 대신 의존성 이관). 1.7.11은 `minimumReleaseAgeExclude` 변경과 `better-auth` 상향이 필요해 승인 없이 쓰지 않는다.
- 2026-10-20 (PK1d): 사전 등록(`POST /api/account/members`)은 이메일이 이 계정 구성원이면 409(`member_exists`)로 답하고 이름을 바꾸지 않는다. 등록 링크 재발급 대신 passkey 초기화를 안내한다. 이 계정에 속하지 않은 기존 사용자(다른 회사 소속, passkey 보유, 소속도 passkey도 없는 고아 계정)는 셋 모두 같은 409(`enrollment_email_unavailable`, 문구 "사용할 수 없는 이메일입니다")로 거부하고 이 계정에 붙이지 않는다. 응답·로그 메시지에는 사유를 싣지 않고, 사유(`other_company`·`has_passkey`·`orphan_account`)는 `member.pre_register` 감사(result=failure, reason)에만 INSERT한다. 이메일로 남의 계정에 링크를 만들면 그 사람의 계정을 넘겨받게 되기 때문이다. **변경 사실**: 초기 PK1a 설계(고아 계정을 이 계정 구성원으로 붙임)는 PK1d 리뷰 결정으로 바꿨다. PK1a 서비스 테스트의 고아 기대값도 거부로 고쳤다. **남는 한계**: 이메일은 전역 유일하므로 "사전 등록 불가"라는 1비트 존재 신호는 원리상 남는다(관리자 권한·PIN 재인증·기존 속도 제한 뒤에 있다). 응답 본문은 같지만 쿼리 수·응답 시간 차이는 완전히 지우지 못했다(두 조회를 항상 함께 돈다). 재발급(`POST /api/account/members/{userId}/enrollment`)은 passkey가 있으면 409(`has_passkey`), 구성원이 아니면 404다. 권한은 `member.passkey_reset`(소유자·관리자)을 재사용한다. 소유자 계정의 등록 링크는 소유자만 발급한다. 권한 action을 새로 만들지 않아 `shared/src/domain` 권한표를 건드리지 않았다. 결재 PIN 재인증은 권한 확인 뒤에 한다.
- 2026-10-20 (PK1c): 관리자 초기화는 계정 관리자 이상(소유자·관리자)만 한다. 사업자 관리자는 계정 복구 권한이 없어 제외했다. 소유자의 passkey는 소유자만 초기화한다(관리자가 소유자 계정을 넘겨받는 길을 막는다). 대상이 같은 계정 구성원이 아니면 404다. 재인증은 권한 확인 뒤에 하므로 권한 없는 사람은 428이 아닌 403을 받는다. 초기화 때 미사용 등록 토큰은 기존 재발급 규칙으로 무효가 된다.
- 2026-10-20 (PK1b): 마지막 passkey는 삭제할 수 없다(409, `canDeletePasskey`). 삭제 전 본인 행을 잠가 동시 삭제에도 1개가 남게 한다. passkey 관리(목록·이름·삭제)는 자체 API(`/api/me/passkeys`)만 쓰고 플러그인의 같은 경로는 `disabledPaths`로 막아 감사 로그를 빠뜨리지 않는다. rpID·origin은 서버 `BETTER_AUTH_URL`에서만 정한다(요청 헤더의 origin은 믿지 않는다).

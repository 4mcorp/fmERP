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
- [ ] PK1c: 관리자 초기화
- [ ] PK2: 로그인 화면·Google 안내 문구 제거

## 완료 기준
- `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:int`(변경 관련 파일), `pnpm arch:check` 위반 0
- 통합 테스트: 사전 등록 중복 방지, 토큰 원문 미저장, 재발급 시 이전 토큰 거부, 재사용 거부, 만료 거부, 다른 계정 RLS 격리, 앱 역할의 passkey 접근 거부

## 결정·변경 기록
- 2026-10-20: 카드 범위를 PK1a/1b/1c로 나눈다. 1a는 스키마·마이그레이션·서비스만 한다. 라우트와 관리자 초기화는 뒤 카드에서 한다.
- 2026-10-20: `@better-auth/passkey`는 PK1b로 옮겼다. PK1a에서 추가하면 knip(미사용 의존성) 게이트가 실패한다. 소유자 결정(knip 예외 추가 대신 의존성 이관). 1.7.11은 `minimumReleaseAgeExclude` 변경과 `better-auth` 상향이 필요해 승인 없이 쓰지 않는다.
- 2026-10-20 (PK1b): 마지막 passkey는 삭제할 수 없다(409, `canDeletePasskey`). 삭제 전 본인 행을 잠가 동시 삭제에도 1개가 남게 한다. passkey 관리(목록·이름·삭제)는 자체 API(`/api/me/passkeys`)만 쓰고 플러그인의 같은 경로는 `disabledPaths`로 막아 감사 로그를 빠뜨리지 않는다. rpID·origin은 서버 `BETTER_AUTH_URL`에서만 정한다(요청 헤더의 origin은 믿지 않는다).

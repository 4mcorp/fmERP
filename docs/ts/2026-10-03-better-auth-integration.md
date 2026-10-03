---
title: Better Auth 연동 시 함정 (스키마 검사, disabledPaths 범위, 초대 이메일 일치)
date: 2026-10-03
status: resolved
tags: [auth, better-auth, db, security]
related: [packages/auth/src/auth.ts, docs/adr/0005-better-auth-organization-as-tenant.md]
---

## 증상
1. 테스트 로그인이 500. 서버 로그: `SchemaMismatchError ... Missing tables unused_ba_invitation`
2. 설계 중 확인: Better Auth 초대 수락은 **초대 이메일과 로그인 이메일이 같아야** 한다. PRD의 링크 초대(AUTH-006)를 충족하지 못한다.
3. 설계 중 확인: `disabledPaths`가 서버의 `auth.api.*` 호출까지 막는지 불명확했다.

## 원인
1. Better Auth는 시작할 때 설정된 모든 모델(사용하지 않는 organization 초대 포함)의 Drizzle 테이블이 있는지 검사한다.
2. organization 플러그인의 `acceptInvitation`이 이메일 일치를 검사한다.
3. `disabledPaths`는 HTTP 라우터(`dist/api/index.mjs`)에서만 검사한다. 서버 API 호출에는 적용되지 않는다.

## 해결
1. `advanced.database.validateSchema: false`. 대신 스키마 일치는 통합 테스트(로그인·계정·구성원 흐름)로 검증한다.
2. 초대는 자체 `invitation` 테이블(토큰 해시·1회용)로 구현하고, 수락 시 `auth.api.addMember`를 호출한다 (ADR 0005).
3. 감사 로그를 우회할 수 있는 HTTP 경로(organization 전체, update-user, 세션 해지 등)는 `disabledPaths`로 막고, 같은 기능은 감사 로그를 남기는 자체 API로 제공한다. 서버 코드에서는 `auth.api.*`를 계속 쓸 수 있다.

## 재발 방지 규칙
- Better Auth 플러그인을 추가하면 그 플러그인이 여는 HTTP 경로 목록을 확인한다. 감사 로그·업무 규칙을 우회하는 경로는 `disabledPaths`에 넣는다.
- 드리즐 어댑터 `schema`의 키는 테이블 이름이 아니라 **모델 이름**(modelName)이다.
- Better Auth 설정을 바꾸면 통합 테스트 `apps/web/server/m1.int.test.ts`를 실행해 스키마·흐름을 확인한다 (스키마 자동 검사를 껐기 때문).
- Better Auth의 옵션·동작은 설치된 버전의 타입 정의(`@better-auth/core/dist/types/init-options.d.mts`)와 dist 코드로 확인한다.

## 재발 기록

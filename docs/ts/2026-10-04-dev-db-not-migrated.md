---
title: 개발 DB에 마이그레이션이 적용되지 않아 로그인 후 화면이 비고 API가 500을 돌려줌
date: 2026-10-04
status: resolved
tags: [db, migration, dev, test, workflow]
related: [README.md, CLAUDE.md, packages/db/migrations]
---

## 증상
- 시드 계정으로 로그인하면 상단 메뉴(새 결재·결재 대기·기안함·조직도)만 보이고 본문이 비어 있다.
- 브라우저 네트워크 탭에서 `/api/forms`, `/api/departments`, `/api/businesses`, `/api/inbox/*`, `/api/account/capabilities`가 모두 500이다. `/api/account`만 200이다.

## 원인
- 개발 서버가 쓰는 개발 DB(`localhost:55432`)에 마이그레이션이 M1 시점(13개 중 일부)까지만 적용되어 있었다. `department`·`business`·`form`·`document` 테이블이 없었다.
- 자동 테스트(`pnpm test:int`, E2E)는 **별도의 테스트 DB(55433)를 실행할 때마다 초기화하고 마이그레이션을 새로 적용**한다. 그래서 개발 DB가 오래돼도 테스트는 계속 통과하고, 문제가 화면을 직접 열어 볼 때만 드러났다.

## 해결
- 개발 DB에 `pnpm db:migrate`, `pnpm db:seed`를 실행했다. 마이그레이션은 테이블 추가 중심이라 기존 데이터를 지우지 않고, 시드는 upsert다. 시드가 사용자 행을 갱신하므로 열려 있던 로그인 세션은 풀린다(`/dev-login`에서 다시 로그인).

## 재발 방지 규칙
- 개발 서버를 켜기 전, 또는 `packages/db/migrations`에 새 파일이 생겼을 때는 `pnpm db:migrate`를 먼저 실행한다. 조직·양식 시드가 늘었으면 `pnpm db:seed`도 실행한다 (README·CLAUDE.md에 명시).
- 화면이 비고 여러 API가 한꺼번에 500이면 코드보다 먼저 개발 DB의 마이그레이션 상태를 의심한다: `select count(*) from drizzle.__drizzle_migrations` 값과 `packages/db/migrations`의 SQL 파일 수를 비교한다.
- 화면 작업을 끝낼 때는 테스트 통과만 보고하지 않고, 개발 서버에서 해당 화면을 한 번 열어 데이터가 보이는지 확인한다.

## 재발 기록

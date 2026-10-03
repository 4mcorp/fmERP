---
title: drizzle-kit이 만든 마이그레이션이 복합 외래 키 대상의 UNIQUE 제약보다 외래 키를 먼저 만들어 실패함
date: 2026-10-03
status: resolved
tags: [db, migration, drizzle]
related: [packages/db/migrations/0003_org_permission.sql, packages/db/src/schema/org.ts]
---

## 증상
M2 마이그레이션 적용 시 `there is no unique constraint matching given keys for referenced table "membership"`로 실패했다.

## 원인
기존 `membership` 테이블에 `UNIQUE(id, account_id)`를 추가하고 새 테이블이 `(id, account_id)` 복합 외래 키로 참조했다. drizzle-kit은 새 테이블의 외래 키를 먼저, 기존 테이블에 대한 `ALTER TABLE … ADD CONSTRAINT UNIQUE`를 마지막에 출력한다.

## 해결
생성된 SQL에서 기존 테이블의 UNIQUE·CHECK `ADD CONSTRAINT` 문을 외래 키 문들 앞으로 옮겼다. 아직 어디에도 적용되지 않은 마이그레이션이라 수정할 수 있었다.

## 재발 방지 규칙
- 기존 테이블에 UNIQUE를 추가하고 그것을 외래 키로 참조하는 마이그레이션은, `drizzle-kit generate` 후 SQL의 문장 순서를 확인하고 필요하면 고친다. 적용 전(테스트 DB 통합 테스트 실행)에 반드시 한 번 돌려 확인한다.
- 이미 적용된 마이그레이션은 수정하지 않는다 (database.md 3장).

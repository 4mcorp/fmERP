---
title: pg-boss 시작 시 "permission denied for database" (앱 계정 권한 분리)
date: 2026-10-03
status: resolved
tags: [db, worker, pg-boss, permission]
related: [docker/postgres/initdb/01-roles.sh, docs/rules/database.md, apps/worker/src/main.ts]
---

## 증상
worker 시작 시 `boss.start()`에서 `error: permission denied for database fmerp`가 나며 종료된다. `pgboss` 스키마는 미리 만들어 앱 계정에 소유권을 줬는데도 실패했다.

## 원인
pg-boss는 처음 설치할 때 `CREATE SCHEMA IF NOT EXISTS pgboss`를 실행한다. PostgreSQL은 **스키마가 이미 있어도 DB 수준 CREATE 권한을 먼저 검사**한다. 앱 계정(`fmerp_app`)에는 이 권한을 주지 않았었다.

## 해결
`01-roles.sh`에서 `GRANT CONNECT, TEMPORARY, CREATE ON DATABASE ... TO fmerp_app`으로 바꾸고, 이미 떠 있던 개발·테스트 DB에도 같은 GRANT를 실행했다. 앱 계정은 새 스키마를 만들 수 있지만, 마이그레이션 계정이 소유한 `public` 스키마의 테이블 구조는 여전히 바꿀 수 없다(통합 테스트로 확인). worker 기동과 heartbeat 실행을 확인했다.

## 재발 방지 규칙
- 운영 DB를 처음 준비할 때도 같은 `01-roles.sh`를 써서 권한이 개발 환경과 같게 한다.
- DB 초기화 스크립트를 바꾸면 기존 볼륨에는 자동 반영되지 않는다. 기존 개발 DB에는 같은 SQL을 직접 실행하거나 볼륨을 다시 만든다.
- 권한 오류가 나면 PostgreSQL의 검사 순서(권한 → 존재 여부)를 먼저 의심한다.

## 재발 기록

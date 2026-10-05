---
title: 백업 역할(fmerp_backup)이 기존 DB 볼륨에 없어 마이그레이션 0016이 실패함
date: 2026-10-05
status: resolved
tags: [db, migration, backup, infra]
related: [docker/postgres/initdb/01-roles.sh, packages/db/migrations/0016_backup_rls_roles.sql, docs/ts/2026-10-03-pgboss-schema-permission.md]
---

## 증상
M7 마이그레이션 `0016_backup_rls_roles`를 적용하면 `fmerp_backup 역할이 없습니다`로 실패한다 (이미 만들어진 개발·테스트·운영 DB).

## 원인
역할은 `docker/postgres/initdb/01-roles.sh`가 만들지만 이 스크립트는 **DB 볼륨을 처음 만들 때만** 실행된다. 이미 있는 볼륨에는 새 역할이 생기지 않는다 ([pg-boss 때와 같은 구조](2026-10-03-pgboss-schema-permission.md)). 마이그레이션 계정(`fmerp_migrator`)은 역할을 만들 수 없고(BYPASSRLS는 슈퍼유저만 부여), 그래서 마이그레이션은 역할이 없으면 일부러 먼저 멈춘다.

## 해결
기존 DB에는 **슈퍼유저로 한 번** 같은 SQL을 실행한 뒤 `pnpm db:migrate`를 한다. 개발 컨테이너:

```bash
docker exec fmerp-dev-postgres-1 psql -U postgres -d fmerp -c "CREATE ROLE fmerp_backup LOGIN BYPASSRLS PASSWORD 'fmerp_backup_dev'; GRANT pg_read_all_data TO fmerp_backup; GRANT CONNECT ON DATABASE fmerp TO fmerp_backup; GRANT USAGE ON SCHEMA public TO fmerp_backup;"
```

통합 테스트 DB(`fmerp-dev-postgres-test-1`)는 컨테이너를 새로 만들면 `01-roles.sh`로 생기고, 이미 떠 있으면 같은 명령을 `-test-1`에 실행한다. `.env`에는 `BACKUP_DATABASE_URL`을 추가한다(`.env.example` 참고). 운영 DB는 비밀번호를 `BACKUP_DB_PASSWORD`로 넣어 `01-roles.sh`와 같은 SQL을 실행한다.

## 재발 방지 규칙
- DB 역할·확장처럼 **슈퍼유저만 만들 수 있는 것**을 마이그레이션이 요구하면, 없을 때 **원인을 알려 주는 오류로 먼저 멈추게** 하고(0016처럼), 기존 볼륨 적용 방법을 이 같은 ts 문서에 적는다.
- 새 역할을 `01-roles.sh`에 추가하면 같은 커밋에서 `.env.example`·`vitest.config.ts`의 연결 문자열도 추가한다.

## 재발 기록

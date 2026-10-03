#!/usr/bin/env bash
# DB 역할 분리 (docs/rules/database.md 4장, ADR 0005)
# - fmerp_migrator: DB·public 스키마 소유자. 마이그레이션(DDL) 전용
# - fmerp_app: 앱 업무 데이터. 테이블 권한은 마이그레이션에서 테이블마다 명시적으로 부여하고, RLS가 적용된다
# - fmerp_auth: Better Auth 전용. 테넌트 지정 전에 구성원·세션을 조회해야 해서 RLS를 우회한다(BYPASSRLS)
# 운영 서버에서도 같은 스크립트를 쓰고, 비밀번호는 환경 변수로 넣는다.
# 이 스크립트는 DB 볼륨을 처음 만들 때만 실행된다. 바꾸면 기존 볼륨에는 같은 SQL을 직접 실행한다
# (docs/ts/2026-10-03-pgboss-schema-permission.md).
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE fmerp_migrator LOGIN PASSWORD '${MIGRATOR_DB_PASSWORD:-fmerp_migrator_dev}';
  CREATE ROLE fmerp_app LOGIN PASSWORD '${APP_DB_PASSWORD:-fmerp_app_dev}';
  CREATE ROLE fmerp_auth LOGIN BYPASSRLS PASSWORD '${AUTH_DB_PASSWORD:-fmerp_auth_dev}';

  ALTER DATABASE "$POSTGRES_DB" OWNER TO fmerp_migrator;
  REVOKE ALL ON DATABASE "$POSTGRES_DB" FROM PUBLIC;
  -- CREATE: pg-boss가 시작할 때 CREATE SCHEMA IF NOT EXISTS pgboss를 실행하는데, PostgreSQL은 스키마가
  -- 이미 있어도 DB 수준 CREATE 권한을 먼저 검사한다. public 스키마는 마이그레이션 계정 소유라 앱 계정이 바꿀 수 없다.
  GRANT CONNECT, TEMPORARY, CREATE ON DATABASE "$POSTGRES_DB" TO fmerp_app;
  GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO fmerp_auth;

  ALTER SCHEMA public OWNER TO fmerp_migrator;
  GRANT USAGE ON SCHEMA public TO fmerp_app, fmerp_auth;

  -- pg-boss 작업 큐는 자체 스키마를 앱 계정이 관리한다 (큐 생성 시 파티션 테이블을 만듦)
  CREATE SCHEMA pgboss AUTHORIZATION fmerp_app;
EOSQL

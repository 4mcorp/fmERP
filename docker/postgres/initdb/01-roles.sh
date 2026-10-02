#!/usr/bin/env bash
# DB 계정 분리 (docs/rules/database.md 4장)
# - fmerp_migrator: DB·public 스키마 소유자. 마이그레이션(DDL) 전용
# - fmerp_app: 앱 실행 계정. 테이블 DML만 가능, DDL 불가
# 운영 서버에서도 같은 스크립트를 쓰고, 비밀번호는 환경 변수로 넣는다.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE fmerp_migrator LOGIN PASSWORD '${MIGRATOR_DB_PASSWORD:-fmerp_migrator_dev}';
  CREATE ROLE fmerp_app LOGIN PASSWORD '${APP_DB_PASSWORD:-fmerp_app_dev}';

  ALTER DATABASE "$POSTGRES_DB" OWNER TO fmerp_migrator;
  REVOKE ALL ON DATABASE "$POSTGRES_DB" FROM PUBLIC;
  GRANT CONNECT, TEMPORARY ON DATABASE "$POSTGRES_DB" TO fmerp_app;

  ALTER SCHEMA public OWNER TO fmerp_migrator;
  GRANT USAGE ON SCHEMA public TO fmerp_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE fmerp_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fmerp_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE fmerp_migrator IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO fmerp_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE fmerp_migrator IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO fmerp_app;

  -- pg-boss 작업 큐는 자체 스키마를 앱 계정이 관리한다 (큐 생성 시 파티션 테이블을 만듦)
  CREATE SCHEMA pgboss AUTHORIZATION fmerp_app;
EOSQL

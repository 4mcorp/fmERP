-- 부서 트리(ltree)와 한국어 부분 일치 검색(pg_trgm)용 확장. 둘 다 trusted 확장이라 DB 소유자(마이그레이션 계정)가 설치할 수 있다.
CREATE EXTENSION IF NOT EXISTS ltree;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;

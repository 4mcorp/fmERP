---
status: accepted
---

# 통합 테스트는 Docker Compose의 전용 PostgreSQL·로컬 S3로 실행

통합 테스트(`*.int.test.ts`)는 `docker-compose.dev.yml`의 `postgres-test`(tmpfs, 포트 55433)와 `s3`(SeaweedFS, 포트 58333)를 쓴다. Vitest `globalSetup`이 실행마다 최신 마이그레이션을 적용하고 테스트 버킷을 만든다. CI도 같은 Compose 파일로 서비스를 띄워 로컬과 동일한 조건에서 실행한다. DB 관련 테스트는 목(mock)을 쓰지 않는다 (docs/rules/testing.md).

**Considered Options:** Testcontainers(테스트마다 컨테이너 생성 — Windows에서 느리고 의존성 추가), PGlite(인메모리 — PostgreSQL 18 기능·권한 모델과 차이가 있음).

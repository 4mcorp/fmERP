---
title: 격리된 테스트 DB에서 백업 덤프·리허설 불일치
date: 2026-10-12
status: resolved
tags: [ci, test, db, backup]
related: [features/backup/tests/dump.int.test.ts, features/backup/tests/rehearse.int.test.ts, packages/db/test/reset-test-db.ts]
---

## 증상

통합 테스트를 별도 56433 컨테이너에서 돌리려 했으나 resetTestDatabase가 55433 이외 주소를 거부했다. 안전 검사를 유지하고 55433 테스트 서버에 별도 DB를 생성하자 418개 중 백업 관련 3개가 실패했다. 호스트 연결로 조회한 행 수와 복원 결과가 달랐다.

## 원인

dump.int.test.ts의 dumpConfig 기본 DB 이름 및 rehearse.int.test.ts의 pg_dump URL이 fmerp로 고정돼 있었다. DATABASE_URL 등의 DB를 바꾸어도 컨테이너 pg_dump는 원래 fmerp DB를 읽었다. 이는 테스트 기대값 문제가 아니라 서로 다른 DB를 비교한 설정 불일치였다.

## 해결과 검증

pg_dump가 읽을 DB 이름을 BACKUP_DATABASE_URL의 pathname에서 가져오도록 수정했다. 기대값은 변경하지 않았다. 실패 파일 2개의 12개 시험 재실행이 통과했으며 전체 통합 32파일/418개도 통과했다. 기본 URL이 /fmerp이면 기존 동작은 동일하다.

## 재발 방지

- resetTestDatabase의 포트 안전 검사를 우회하거나 약화하지 않는다.
- 공유 테스트 DB를 초기화하지 않으려면 55433 테스트 서버에 실행별 DB를 만들고 migrator 소유권·app/auth/backup 권한·pgboss 스키마를 설정한다.
- 호스트 연결과 컨테이너 pg_dump/pg_restore가 같은 DB 이름을 사용하게 한다. 컨테이너 내부 포트는 5432이고 호스트 포트는 55433임을 구분한다.
- 같은 DB를 사용하는 통합·E2E는 동시에 실행하지 않는다. 병렬 검증은 DB와 S3 프로젝트/버킷을 분리한다.
- 테스트 전용 임시 DB·컨테이너·볼륨만 정리한다. E2E env를 임시 변경했다면 finally에서 원본을 바이트 단위로 복원한다.

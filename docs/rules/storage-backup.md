# 파일 저장·백업·이관 규칙

기준: [PRD 5.6 BAK · 5.10 FILE](../PRD.md) · [DEPLOYMENT_PLAN 2장(버킷 구조) · 8장(덤프·복구·이관)](../DEPLOYMENT_PLAN.md)

## 1. S3 사용
- S3 접근은 `packages/storage` 어댑터로만 한다.
- 키 구조는 DEPLOYMENT_PLAN 2.1을 그대로 따른다. 새 경로가 필요하면 그 문서부터 갱신한다.
- 작성 중 본문은 저장할 때마다 `revisions/{n}.json`을 **새 키로** 쓴다. 기존 키를 덮어쓰지 않는다.
- 결재가 완료되면 `final/`에 `document.pdf`, `document.json`, `approval.json`, `manifest.json`을 **한 번만** 쓴다. 이미 있으면 실패로 처리한다 (PRD BAK-003).
- 앱용 S3 키에는 삭제 권한이 없다. 정리는 버킷 수명 주기 규칙으로 한다.
- S3 클라이언트의 체크섬 옵션(`requestChecksumCalculation`·`responseChecksumValidation` = `WHEN_REQUIRED`)을 유지한다. 바꾸면 브라우저 서명 URL 업로드가 깨진다 ([ts](../ts/2026-10-03-s3-presigned-checksum.md)).

## 2. 완료 패키지 내용
- `approval.json`: 결재선, 단계별 처리자·대결 여부·일시·IP·의견, 문서번호, 파일별 SHA-256
- `manifest.json`: 패키지 안 모든 파일의 경로·크기·SHA-256
- 패키지만으로 문서 열람과 결재 사실 증명이 가능해야 한다. DB가 없어도 의미가 통해야 한다.

## 3. DB 덤프
- 자동 덤프는 worker가 매일 03:00 KST에 실행하고, 수동 덤프는 관리 콘솔에서 실행한다 (PRD BAK-005·006).
- 덤프는 `pg_dump -Fc` → age로 암호화 → `_system/db-dumps/` 순서로 처리한다. 해시와 크기를 `backup_job`에 기록한다.
- 실패하면 30분 안에 관리자에게 알린다.

## 4. 이관·복구 도구
S3 패키지로 DB 색인을 다시 만드는 스크립트(PRD BAK-010)는 **완료 패키지 형식과 함께 유지보수**한다. 패키지 형식을 바꾸면 이 스크립트와 그 테스트도 같은 커밋에서 바꾼다.

# 파일 저장·백업·이관 규칙

기준: [PRD 5.6 BAK · 5.10 FILE](../PRD.md) · [DEPLOYMENT_PLAN 2장(버킷 구조) · 8장(덤프·복구·이관)](../DEPLOYMENT_PLAN.md)

## 1. S3 사용
- S3 접근은 `packages/storage` 어댑터로만 한다.
- 키 구조는 DEPLOYMENT_PLAN 2.1을 그대로 따른다. 새 경로가 필요하면 그 문서부터 갱신한다.
- 작성 중 본문은 저장할 때마다 `revisions/{n}.json`을 **새 키로** 쓴다. 기존 키를 덮어쓰지 않는다.
- 결재가 완료되면 `final/`에 `document.pdf`, `document.json`, `approval.json`, `manifest.json`을 **한 번만** 쓴다. 이미 있으면 실패로 처리한다 (PRD BAK-003). 순서는 `document.json` → `approval.json` → `document.pdf` → `manifest.json`이고 manifest가 있어야 완성이다. 재시도 때 이미 있는 객체는 해시를 확인한다 ([ADR 0009](../adr/0009-completion-package-and-document-search.md)).
- 완료 이후의 후결 승인은 `final/`이 아니라 `post-approvals/{단계ID}.json`에 한 건씩 한 번만 쓴다.
- 앱용 S3 키에는 삭제 권한이 없다. 정리는 버킷 수명 주기 규칙으로 한다.
- S3 클라이언트의 체크섬 옵션(`requestChecksumCalculation`·`responseChecksumValidation` = `WHEN_REQUIRED`)을 유지한다. 바꾸면 브라우저 서명 URL 업로드가 깨진다 ([ts](../ts/2026-10-03-s3-presigned-checksum.md)).

## 2. 완료 패키지 내용
- `approval.json`: 결재선, 단계별 처리자·대결 여부·일시·IP·의견, 문서번호, 파일별 SHA-256
- `manifest.json`: 패키지 안 모든 파일의 경로·크기·SHA-256. 첨부는 복사하지 않고 S3 키·크기·SHA-256을 참조로 적는다
- 패키지만으로 문서 열람과 결재 사실 증명이 가능해야 한다. DB가 없어도 의미가 통해야 한다.

## 3. DB 덤프·내보내기
- **덤프** ([ADR 0011](../adr/0011-backup-export-and-recovery.md)): worker가 매일 03:00 KST에 자동 실행하고, 수동은 시스템 관리자가 요청한다(PRD BAK-005·006). `pg_dump -Fc`(백업 전용 역할 `fmerp_backup`, `session`·`verification` 데이터와 `pgboss` 제외) → **age 암호화(서버에는 공개키만)** → 임시 파일(크기·SHA-256) → `_system/db-dumps/{daily,weekly,manual}/` 업로드 → 올라간 객체 해시 재검증. 이력은 `system_backup`(계정 없음, 끝난 행은 고정). 변경이 없으면 자동 덤프는 건너뛴다(변경 토큰).
- 덤프에는 모든 계정의 데이터가 들어가므로 **시스템 관리자(`SYSTEM_ADMIN_EMAILS`)만** 다룬다. 요청·다운로드·삭제는 PIN 재인증과 감사 로그가 필수다.
- 앱 키에는 삭제 권한이 없다. 덤프 정리는 버킷 수명 주기 규칙(daily 7일·weekly 28일, `expire=1` 태그 1일)으로 한다. 수동 덤프 "삭제"는 객체에 태그를 붙이는 것이다.
- **계정 내보내기** (PRD BAK-009): worker가 ZIP을 스트리밍으로 만들어 `exports/{계정}/{작업}.zip`에 올린다(`backup_job`, RLS). READY 완료 패키지가 있는 문서·첨부·조직·양식·감사 로그, `manifest.json`. 7일 보관, 받을 때마다 PIN 재인증 + 10분 서명 URL.
- 새 감사 로그 행위(`backup.*`, `account.export_*`)의 `reason`에 개인정보를 넣지 않는다.

## 4. 이관·복구 도구
운영자 CLI(`pnpm backup:*`, 절차는 [docs/ops/migration.md](../ops/migration.md)): `backup:dump`, `backup:restore`, `backup:rehearse`(복구 리허설), `backup:reindex`(S3 패키지로 DB 색인 재구성).

**패키지 형식을 바꾸면 색인 재구성 코드(`packages/backup/src/reindex.ts`)와 그 테스트를 같은 커밋에서 바꾼다.** `approval.json`(schemaVersion 2)의 `restore` 블록이 재구성의 입력이다. 형식 버전을 올릴 때는 이전 버전 패키지를 건너뛰고 이유를 보고하는지(옛 형식) 함께 확인한다.

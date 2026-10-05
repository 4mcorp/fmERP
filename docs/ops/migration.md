# 복구·이관 절차 (운영자용)

기준: [PRD 5.6 BAK](../PRD.md) · [DEPLOYMENT_PLAN 8장](../DEPLOYMENT_PLAN.md) · [ADR 0011](../adr/0011-backup-export-and-recovery.md)

> **검증 상태:** 이 문서의 `backup:*` 명령은 개발 DB·S3·컨테이너에서 실행해 확인했다. **`rclone` 명령, 버킷 수명 주기·Object Lock, 서버 하드웨어 교체 절차는 이 PC에서 실행하지 못해 "미검증"이다.** 스테이징(M8)과 복구 리허설(M9)에서 확인하고 이 표시를 지운다.

## 0. 준비물
- **age 개인키 파일** (`AGE-SECRET-KEY-1…`). 서버에는 없다. 비밀번호 관리자에 **2부** 보관한다. 분실하면 모든 덤프를 열 수 없다. 키를 만들 때 공개키(`age1…`)를 서버 `.env`의 `BACKUP_AGE_RECIPIENTS`에 넣는다(복수 가능, 쉼표 구분). 키를 바꾸면 이전 덤프는 이전 개인키로만 열린다.
- 서버 `.env`: `BACKUP_DATABASE_URL`, `BACKUP_AGE_RECIPIENTS`, `SYSTEM_ADMIN_EMAILS`, (CLI) `PG_RESTORE_COMMAND`·`REHEARSAL_ADMIN_URL`.
- DB 역할 `fmerp_backup`: `docker/postgres/initdb/01-roles.sh`가 만든다. 기존 볼륨에는 [ts 문서](../ts/2026-10-05-backup-role-existing-volume.md)의 SQL을 슈퍼유저로 한 번 실행한다.

## 1. 평소 점검
- 시스템 관리자 화면 `/system/backups`: 마지막 성공 시각, 백업 상태("자동 덤프가 기한 안에 성공하지 못했습니다" 경고). 알림 발송은 M8.
- 분기 1회 **복구 리허설**:
  ```bash
  pnpm backup:rehearse --identity=<개인키 파일>
  ```
  임시 DB에 최신 덤프를 복원하고 표별 행 수와 무작위 완료 패키지 20건의 해시를 검증한 뒤 임시 DB를 지운다. 결과 JSON의 `ok`가 `true`여야 하고, `documentCountMatches`가 `false`면 덤프 이후 완료된 문서가 있는지 확인한다. `--keep`이면 임시 DB를 남긴다.

## 2. 서버 하드웨어 고장 복구 (DEPLOYMENT_PLAN 8.3) — 미검증
1. 예비 장비에 Docker를 설치하고 저장소에서 Compose 파일과 암호화된 `.env`를 받아 복호화한다.
2. DB를 새로 띄운다(`01-roles.sh`가 역할을 만든다). 마이그레이션을 적용한다(`pnpm db:migrate`).
3. S3에서 최신 덤프를 복원한다:
   ```bash
   pnpm backup:restore --from=<S3 키 또는 내려받은 파일> --identity=<개인키 파일> --target=<새 DB URL>
   ```
   대상 DB가 비어 있어야 한다(아니면 거부, `--force`로 덮어쓰기 확인). 끝나면 표별 행 수가 출력된다.
4. **마지막 덤프 이후 완료된 문서를 되살린다.** 먼저 드라이런으로 확인한다:
   ```bash
   pnpm backup:reindex --all --dry-run
   pnpm backup:reindex --all
   ```
   종료 코드 3이면 건너뛴 문서가 있다(해시 불일치·옛 형식·DB에 없는 구성원 등). 출력의 `skipped`와 이유를 확인한다. **마지막 덤프 이후 진행 중이던 문서와 후결 승인은 복구되지 않는다**(DB RPO 24시간, ADR 0011 한계).
5. 같은 S3 버킷을 바라보도록 설정하고, **같은 Tunnel 토큰으로 cloudflared를 실행**한다. 원래 서버의 cloudflared는 반드시 꺼 둔다.

## 3. 다른 서버·VPS·서비스로 이관 (DEPLOYMENT_PLAN 8.4) — 미검증
1. 시스템 관리자 화면에서 **수동 덤프**를 실행한다(또는 `pnpm backup:dump --note="이관 직전"`).
2. 버킷 전체를 복사한다 (`rclone`은 이 PC에 없어 명령 확인 못 함):
   ```bash
   rclone sync <원본 remote>:<버킷> <대상 remote>:<버킷> --checksum
   ```
3. 대상에서 같은 Compose로 기동하고 2절의 3~4단계(복원 → 색인 재구성)를 한다.
4. Tunnel 토큰을 이전하고 원래 서버를 끈다.
- **문서만 보관(서비스 종료 후):** 버킷의 `docs/**/final/`만 복사한다. 패키지는 DB 없이도 열람·검증할 수 있다(`manifest.json`의 해시).
- **계정 단위 내보내기:** 관리 콘솔 `/admin/backups`에서 소유자가 요청한다(소유자가 허용하면 계정 관리자도). ZIP의 `manifest.json`에 모든 파일의 경로·크기·SHA-256이 있다. 받을 때마다 PIN 재인증과 감사 로그가 있고, 파일은 7일 보관된다.

## 4. 배포 직전 덤프
```bash
pnpm backup:dump --note="배포 직전"
```
결과 JSON의 `status`가 `SUCCEEDED`일 때만 배포를 진행한다(종료 코드 1이면 실패, 이유는 `/system/backups`의 이력). 다른 덤프가 실행 중이면 `BUSY`다.

## 5. 버킷 설정 (배포 단계, 미검증)
- 앱 키에는 삭제 권한이 없다. 정리는 **수명 주기 규칙**으로 한다:
  - `_system/db-dumps/daily/` — 7일 후 삭제, `_system/db-dumps/weekly/` — 28일 후 삭제
  - **태그 `expire=1`이 붙은 객체 — 1일 후 삭제** (수동 덤프 삭제 요청)
  - `exports/` — 7일 후 삭제, `_staging/` — 1일 후 삭제
- `docs/**/final/`은 Object Lock(버전 관리 포함)으로 보존한다.
- 위 규칙은 로컬 SeaweedFS에는 없다.

## 6. 자주 나는 문제
| 증상 | 확인 |
|---|---|
| 덤프가 `FAILED: pg_dump 실패 …` | worker 이미지에 `postgresql-client-18`이 있는지(`pg_dump --version`), `BACKUP_DATABASE_URL`의 역할·비밀번호 |
| `fmerp_backup 역할이 없습니다` (마이그레이션) | 기존 볼륨에 역할 SQL 미적용 → ts 문서 |
| 복원 시 `age` 오류 | 개인키가 이 덤프의 공개키와 짝인지(키를 바꿨다면 이전 개인키) |
| 리허설 `packages.failed` | S3 패키지 파일이 바뀌었거나 사라졌다. `final/`은 한 번만 쓰므로 원인(키 유출·수동 변경)을 조사 |
| 재구성이 `옛 형식` | 패키지 형식 v1(M7 이전에 만든 패키지). 그 문서는 이 방법으로 복구되지 않는다 |

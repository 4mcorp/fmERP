---
title: M7 덤프·내보내기·이관 상세 계획
date: 2026-10-05
status: draft
tags: [backup, storage, worker, db, api, ui, security, test, infra]
related: [docs/plan/2026-10-03-mvp-roadmap.md, docs/plan/2026-10-04-m5-completion-mailbox.md, docs/rules/storage-backup.md, docs/DEPLOYMENT_PLAN.md, docs/adr/0009, BAK-005, BAK-006, BAK-007, BAK-009, BAK-010, AUD-023, ADM-006]
---

## 목표
DB를 잃어도, 서버를 바꿔도, 서비스를 옮겨도 **문서와 데이터를 되살릴 수 있게** 한다. 구체적으로 ① 매일 자동·관리자 수동으로 **암호화된 DB 덤프**를 서버 밖 S3에 남기고(감사 로그 포함, AUD-023), ② 계정 관리자가 **계정 전체를 ZIP으로 내보내며**, ③ 운영자가 **덤프 복원 + S3 패키지로 DB 색인을 다시 만드는 도구**와 이관 절차 문서로 복구·이관을 수행할 수 있다.

## 현황 (2026-10-05 조사, A1에서 재확인)
| 항목 | 현재 |
|---|---|
| S3 어댑터 | `put`·`putIfAbsent`·`getBytes`·`getStream`·`head`·`getRange`·`hashObject`·`copyIfAbsent`·서명 URL. **목록(list)·스트림 업로드(멀티파트)·태그 없음**. 앱 키에 삭제 수단 없음(BAK-004) |
| worker | pg-boss 큐·스케줄(`boss.schedule`, tz Asia/Seoul)·완료 패키지 생성·스윕. Dockerfile에 `postgresql-client-18`·age **미포함**(주석으로 M7 예정) |
| DB 역할 | `fmerp_migrator`(DDL, 테이블 소유자), `fmerp_app`(RLS), `fmerp_auth`(BYPASSRLS). **백업 전용 역할 없음**. initdb 스크립트는 새 볼륨에서만 실행됨([ts](../ts/2026-10-03-pgboss-schema-permission.md)) |
| 완료 패키지 | `approval.json`·`document.json`·`manifest.json`에 `schemaVersion: 1`. 색인 재구성에 필요한 `businessId`·`formVersionId`·`policy`·단계 처리자 id 등 **일부가 빠져 있음** (아래 6절) |
| 호스트 도구 | 개발 PC에는 `pg_dump`·`pg_restore`·`psql`·`age`·`rclone`이 **없고**, DB 컨테이너(`postgres:18`)에만 `pg_dump`·`pg_restore`가 있음 → 테스트는 컨테이너 안에서 실행 |
| 알림 | 없음(M8). 덤프 실패 알림은 상태·화면 배지까지만 |
| `backup_job` | PRD ERD에만 있고 코드 없음 |

## 범위
**포함 (P0):** BAK-005(자동 일일 덤프), BAK-006(수동 덤프, 운영 배포 직전 실행용 CLI), BAK-007(덤프·내보내기 이력 화면), BAK-009(계정 전체 내보내기), BAK-010(① DB 복원 스크립트·rclone 이관 절차 ② 색인 재구성 스크립트 ③ 이관 절차 문서), AUD-023(덤프에 감사 로그 포함 확인), ADM-006.

**제외:** 오프라인 뷰어(BAK-011, P1), 로컬 2차 사본 가이드(BAK-012, P1), 해지 시 최종 내보내기·파기 확인서(BAK-013, P1), 외부 보관 문서 가져오기(BAK-014, P2), 덤프 실패 **알림 발송**(M8), 버킷 수명 주기·Object Lock **적용**(배포 단계, 로컬 SeaweedFS에서 검증 불가), 문서 단위 PDF·ZIP 다운로드(BAK-008, M5 완료).

## 사전 확인 — 적용할 트러블슈팅
| ts | 적용 |
|---|---|
| pgboss-schema-permission | 새 DB 역할·권한은 initdb에 넣되 **기존 볼륨에는 같은 SQL을 직접 적용**하고 방법을 기록 |
| s3-presigned-checksum | S3 클라이언트는 `packages/storage`에서만 만들고 체크섬 옵션 `WHEN_REQUIRED` 유지. 새 업로드·서명 URL은 **실제 fetch까지** 통합 테스트 |
| drizzle-composite-fk-migration-order | `backup_job` 복합 FK 마이그레이션은 생성 SQL 순서 확인, 적용된 마이그레이션은 수정 금지 |
| audit-view-race-and-concurrent-int-runs | 확인 후 기록·한 번만 실행은 advisory lock + **동시 요청 테스트**. 통합 테스트는 백그라운드로 걸지 않고 한 번에 하나만. 공유 큐(pg-boss)는 시작 시 비움 |
| e2e-fix-loop-and-controlled-folder-access | 실패한 테스트만 재실행, 전체는 단계 끝에 1회, 같은 실패 3회면 멈추고 보고 |
| M6 보안 리뷰 S1 | 새 감사 로그 행위에 문서 내용·개인정보를 `reason`에 넣지 않는다. 관리자는 문서 내용을 볼 수 없다 |

## 설계
### 1. 누가 덤프를 다루는가 (PRD 3.3 각주 3, Q1)
- DB 덤프에는 **모든 계정의 데이터**가 들어가므로 계정 소유자에게 열 수 없다(다중 계정 개발 DB가 그 예). **시스템 관리자**만 실행·조회·다운로드한다.
- 시스템 관리자 = 환경 변수 `SYSTEM_ADMIN_EMAILS`의 이메일과 **로그인한 사용자 이메일(인증됨)이 일치**하는 사람. 파일럿(단일 회사)에서는 소유자 이메일을 넣는다. 설정이 없으면 이 기능 전체가 비활성(404).
- 화면은 계정 전환과 무관한 `/system/backups`(관리 콘솔 밖). 모든 요청은 PIN 재인증과 감사 로그(`account_id` null)를 거친다.

### 2. 덤프 (BAK-005·006)
- **실행:** worker 작업 `backup.dump`(종류 `auto`·`manual`). 자동은 `boss.schedule`로 매일 03:00 KST. 수동은 시스템 관리자가 버튼(PIN)으로 등록한다. 한 번에 하나만 돈다(singleton + advisory lock).
- **순서:** `pg_dump -Fc --no-owner --no-acl --exclude-schema=pgboss` → **age 암호화(공개키만)** → 임시 파일(크기·SHA-256 계산) → S3 업로드 → 올라간 객체를 다시 해시해 일치하면 `SUCCEEDED`. 임시 파일은 끝나면 지운다.
- **백업 전용 DB 역할 `fmerp_backup`:** `LOGIN BYPASSRLS` + `pg_read_all_data`(PG14+ 기본 역할). 쓰기·DDL 권한 없음. RLS 때문에 앱 역할로 덤프하면 일부만 나온다. 연결 문자열은 `BACKUP_DATABASE_URL`(worker만).
- **`session`·`verification` 테이블 데이터는 제외**한다(`--exclude-table-data`). 세션 토큰은 복원에 필요 없고 덤프 유출 시 위험을 줄인다. 감사 로그·조직·결재 상태는 모두 포함(AUD-023).
- **암호화 키:** worker에는 **공개키(`BACKUP_AGE_RECIPIENTS`, 쉼표 구분 복수)** 만 둔다. **복호화 키(개인키)는 서버에 두지 않고** 운영자가 비밀번호 관리자에 2부 보관한다(DEPLOYMENT_PLAN 8.1). 서버가 뚫려도 덤프를 열 수 없고, 시스템 관리자가 받는 파일도 암호화본이다.
- **변경 없으면 건너뜀(자동만):** 변경 토큰 = `pg_stat_user_tables`의 `n_tup_ins+n_tup_upd+n_tup_del` 합계(public 스키마). 직전 성공 덤프의 토큰과 같으면 `SKIPPED`(성공 신호로 취급). 토큰을 못 구하거나 줄어들었으면(통계 초기화) **덤프한다**(안전한 쪽).
- **보관 (Q2):** 일 7개·주 4개는 **버킷 수명 주기 규칙**으로 정리한다(`daily/` 7일, `weekly/` 28일 후 만료). 일요일 자동 덤프는 `weekly/`로 서버 측 복사한다(`copyIfAbsent`). 앱 키에는 삭제 권한이 없다(BAK-004). 수명 주기 적용은 배포 단계이고 로컬 SeaweedFS에는 없다.
- **수동 덤프 삭제 ("관리자가 삭제할 때까지 보관"):** 앱이 직접 지울 수 없으므로 화면의 "삭제"는 객체에 **태그 `expire=1`을 붙이고 이력에서 `삭제 요청`으로 표시**한다. 수명 주기 규칙이 그 태그가 붙은 객체를 1일 뒤 지운다(Q3). 그 전까지는 다운로드할 수 없게 막는다.
- **실패·누락 감지:** `backupHealth(now)`(순수 함수) — 마지막 성공(SUCCEEDED·SKIPPED) 시각, 오늘 03:30 KST가 지났는데 오늘 성공이 없으면 `overdue`. 시스템 화면 배지와 상태 API로 노출하고 **알림 발송은 M8**이 이 함수를 쓴다.
- **운영 배포 직전 덤프:** 배포 스크립트(M8)가 부를 수 있는 CLI `pnpm backup:dump --kind=manual --note=deploy`를 만든다(같은 코드 경로).
- **`system_backup` 테이블 (PRD의 `backup_job`을 둘로 나눔, Q4):** `id, kind(auto|manual), status(RUNNING|SUCCEEDED|SKIPPED|FAILED), requested_by_user_id, note, started_at, finished_at, size, sha256, storage_key, change_token, pg_dump_version, error, delete_requested_at`. 계정 소속이 없고 RLS 대상이 아니라, 앱 역할의 접근은 시스템 관리자 경로 한 곳으로만 한다. INSERT 후 상태 갱신만 허용(DELETE 권한 없음).

### 3. 계정 전체 내보내기 (BAK-009)
- **요청:** 소유자, 또는 소유자가 허용한 계정 관리자(계정 설정 `allowAdminExport`, 기본 꺼짐, PRD 3.3 각주 2). PIN 재인증. 계정당 동시에 하나만. `backup_job`(계정 소속, RLS): `id, account_id, type(account_export), status(QUEUED|RUNNING|READY|FAILED|EXPIRED), requested_by_membership_id, size, sha256, storage_key, expires_at, error, created_at, finished_at`.
- **worker가 ZIP을 스트리밍으로 만들어** `exports/{계정ID}/{작업ID}.zip`에 멀티파트로 올린다(메모리에 쌓지 않음). 내용:
  - `manifest.json` — 형식 버전, 계정, 생성 시각, 파일별 경로·크기·SHA-256, 포함·제외 건수
  - `docs/{사업자코드}/{YYYY}/{문서ID}/final/*`와 `post-approvals/*`, 첨부(`attachments/`) — **READY 패키지가 있는 완료 문서 전부**. 완료되지 않은 문서(진행·반려 등)는 포함하지 않고 건수만 manifest에 적는다(Q5)
  - `org/` — 사업자·부서·직위·직책·구성원(이름·이메일·상태·사번)·소속·역할 부여 (JSON·CSV). **서명·도장 이미지는 제외**
  - `forms/` — 양식과 버전(JSON)
  - `audit/` — 이 계정의 감사 로그(JSON·CSV), 월간 점검 기록
  - CSV는 셀이 `= + - @`로 시작하면 `'`를 붙인다(M5 내보내기와 같은 규칙)
- **내려받기 (Q6):** 파일은 7일간 보관(수명 주기 규칙 + `expires_at`, 지나면 `EXPIRED`로 표시). 내려받을 때마다 **PIN 재인증 + 감사 로그**를 거쳐 **10분짜리 서명 URL**을 발급한다. (PRD는 "7일 유효한 서명 URL"이지만 이는 유출되면 7일간 누구나 받을 수 있는 링크라, 발급 단위를 짧게 하고 보관 기간만 7일로 맞춘다.)
- **비밀번호 암호화는 이번에 제외한다 (Q7)** — ZIP 암호화 라이브러리를 새로 들여야 하고(스택 밖), 전송은 재인증·짧은 URL로 보호한다. 필요하면 후속으로 age 암호화본 제공을 검토한다.
- **관리자 허용 시 위험:** 계정 관리자는 PRD 3.3 각주 1에 따라 문서 본문을 볼 수 없는데, 내보내기 ZIP에는 모든 완료 문서 본문이 들어 있다. 소유자가 설정으로 명시 허용한 경우에만 가능하고(기본 꺼짐), 요청·다운로드마다 감사 로그에 남기며 설정 화면에 이 사실을 경고한다.
- 감사 로그 행위: `account.export_request`·`account.export_ready`·`account.export_download`·`account.export_expire`. `reason`에 개인정보를 넣지 않는다.

### 4. 이력 화면 (BAK-007)
- `/system/backups`: 덤프 이력(일시·유형·크기·해시·상태·실행자·**다운로드 이력**), 수동 덤프 버튼, 삭제 요청, 상태 배지(`overdue`).
- `/admin/backups`(관리 콘솔 메뉴): 이 계정의 내보내기 이력(요청 시각·상태·크기·해시·요청자·만료·다운로드 이력), 내보내기 요청 버튼, 허용 설정 안내. 계정 관리자는 소유자가 허용했을 때만 메뉴가 보인다.
- 다운로드 이력은 감사 로그(`backup.download`·`account.export_download`, 대상 = 작업 ID)에서 읽는다. 문서 단위 다운로드(BAK-008) 이력은 M6 감사 로그 화면에서 본다.

### 5. 복원·이관 도구 (BAK-010 ①③)
- CLI는 `apps/worker/src/cli/`에 두고 루트 `package.json` 스크립트로 노출한다(운영자가 서버에서 실행). 앱·웹은 이 CLI를 부르지 않는다.
- **`pnpm backup:restore`** — `--from=<S3 키 또는 파일> --identity=<age 개인키 파일> --target=<DB URL>`: 내려받기 → age 복호화(스트림) → `pg_restore --no-owner --exit-on-error`. 대상 DB가 비어 있지 않으면 `--force` 없이는 거부. 끝나면 테이블별 행 수와 마이그레이션 일치 여부를 출력한다.
- **`pnpm backup:rehearse`** — 복구 리허설(DEPLOYMENT_PLAN 8.6): 임시 DB에 복원 → 문서 수 비교 → 무작위 패키지 20건 해시 검증 → 결과 JSON·요약 출력. 복원 DB는 `--keep` 없으면 지운다.
- **이관 절차 문서** `docs/ops/migration.md`: 전체 이관(덤프→`rclone sync`→복원→Tunnel 이전), 문서만 보관, 서버 하드웨어 고장 복구(8.3). **rclone 명령은 이 PC에 없어 실행해 확인하지 못한다**(문서에 "미검증"으로 표시하고 스테이징에서 확인, M8·M9).

### 6. 색인 재구성 (BAK-010 ②)
- **`pnpm backup:reindex [--account=<id>] [--since=<시각>] [--dry-run]`** — S3 `docs/**/final/manifest.json`을 훑어(목록 필요) **DB에 없는 완료 문서**를 패키지로부터 되살린다. 복원한 덤프 이후에 완료된 문서를 위한 것이다(진행 중 문서는 DB 덤프에만 있으므로 RPO 24시간 안에서 잃을 수 있음 — 문서에 명시).
- 각 문서마다: manifest 해시와 객체 실제 해시 검증 → `document`(COMPLETED)·단계·처리 기록·`document_package`(READY)·첨부·`document_search`·`document_recipient`(post-approvals 포함) 재생성 → 문서번호 시리즈 `last_seq` 보정. 이미 있는 문서는 건너뛴다(멱등). 해시가 다르면 **그 문서를 건너뛰고 보고**한다(덮어쓰지 않음).
- **패키지 형식 확장 (Q8):** 현재 `approval.json`(v1)에는 재구성에 필요한 `businessId`·`formVersionId`·`policy`·`numbering`·단계의 `assigneeIds`·`delegates`·`drafterSnapshot` 등이 없다. 파일럿 전이라 **`schemaVersion: 2`로 확장**하고(기존 v1 패키지는 읽을 수 있는 만큼만 복원하고 부족한 문서는 보고), `storage-backup.md`·ADR 0009·패키지 생성 테스트와 색인 재구성 테스트를 **같은 커밋에서** 갱신한다(storage-backup.md 4장 규칙).
- **쓰기 경로 위험(A1에서 확인):** `document_before_update`·`approval_step_guard` 같은 트리거가 완료 상태 행 직접 삽입을 막을 수 있다. 막으면 **재구성 전용 `SECURITY DEFINER` 함수**(보안 리뷰 대상)로 우회하고, 앱 역할에는 열지 않는다.
- 필요한 어댑터 기능: `ObjectStorage.list(prefix)`(읽기 전용)을 추가한다.

### 7. 새 패키지·도구 (`dependencies.md` 절차·승인 필요, Q9)
- **`age-encryption`** (TECH_SPEC에 후보로 적힌 순수 JS age 구현, 덤프 스트림 암호화·복호화). 설치 전 라이선스·peer·유지보수·다운로드 수를 검증해 보고한다. (대안: worker 이미지에 age 바이너리 — 이 PC에서 테스트하기 어려워 비추천)
- **`@aws-sdk/lib-storage`** (기존 `@aws-sdk/client-s3`와 같은 계열, 멀티파트 스트림 업로드). 버전은 client-s3와 같은 `~3.1145.0`으로 맞춘다.
- worker 이미지에 **`postgresql-client-18`** 추가(Dockerfile). rclone은 운영자 도구라 이미지에 넣지 않는다.
- 환경 변수: `BACKUP_DATABASE_URL`, `BACKUP_AGE_RECIPIENTS`, `SYSTEM_ADMIN_EMAILS`, `PG_DUMP_COMMAND`·`PG_RESTORE_COMMAND`(기본 `pg_dump`·`pg_restore`; 테스트에서는 DB 컨테이너 안에서 실행하도록 지정).

### 8. 테스트 전략
- 호스트에 `pg_dump`가 없으므로 통합 테스트는 `PG_DUMP_COMMAND="docker exec -i <컨테이너> pg_dump"`처럼 **컨테이너 안에서** 실행한다(`env:up`이 이미 띄운 DB). 컨테이너를 못 찾으면 테스트가 **건너뛰지 않고 실패**하고 안내를 출력한다.
- 덤프 → 복호화(테스트용 개인키) → **빈 임시 DB에 복원 → 행 수·감사 로그 일치 확인**까지 한 흐름으로 검증한다(복원 검증 없는 덤프 테스트는 의미가 없다).
- age 개인키는 **테스트 안에서 생성**하고 저장소·로그에 남기지 않는다.

## 단계 (4개 하위 단계, 태스크마다 커밋, 단계 끝에 전체 검증)
**M7-A 기반**
- [ ] A1. 현황 재확인(트리거와 재구성 쓰기 경로, `fmerp_backup` 역할 적용, 컨테이너 안 `pg_dump` 실행, 패키지 형식 v2 필드 확정), ADR 0011 작성, 패키지 `age-encryption`·`@aws-sdk/lib-storage` 검증 후 보고·승인
- [ ] A2. 스토리지 어댑터: `list`·스트림 업로드·태그 지정(+실제 S3 호출 테스트). `fmerp_backup` 역할(initdb + 기존 볼륨 적용 방법 기록)
- [ ] A3. DB: `system_backup`, `backup_job`(RLS), 계정 설정 `allowAdminExport`, 마이그레이션
- [ ] A4. core(TDD): `backupHealth`, 변경 토큰 비교, 내보내기 manifest·CSV 규칙, 시스템 관리자 판정

**M7-B 덤프**
- [ ] B1. worker `backup.dump`: pg_dump→age→업로드→검증, 임시 파일 정리, 자동 스케줄·주간 복사·건너뜀
- [ ] B2. 시스템 API(`/api/system/backups`): 수동 덤프·이력·상태·다운로드 URL·삭제 요청(시스템 관리자·재인증·감사 로그)
- [ ] B3. CLI `backup:dump`, 통합 테스트(덤프→복호화→빈 DB 복원→행 수 일치, 건너뜀, 동시 실행 방지, 실패 기록)

**M7-C 내보내기와 화면**
- [ ] C1. worker `account.export` ZIP 스트리밍(문서·첨부·org·forms·audit), manifest·해시
- [ ] C2. 계정 API(`/api/account/exports`): 요청·이력·다운로드 URL·허용 설정, 만료 처리
- [ ] C3. 화면 `/system/backups`, `/admin/backups`, 설정의 허용 토글과 경고

**M7-D 복원·재구성·마무리**
- [ ] D1. 패키지 형식 v2 + 색인 재구성 스크립트(드라이런·멱등·해시 불일치 보고) + `storage-backup.md`·ADR 0009 갱신
- [ ] D2. `backup:restore`·`backup:rehearse`, 이관 절차 문서(`docs/ops/migration.md`)
- [ ] D3. E2E, `web-design-guidelines`, 보안 리뷰(`differential-review`), worker Dockerfile `postgresql-client-18`, 문서 정리

## 완료 기준
- [ ] 단위: `backupHealth`(성공·건너뜀·누락·03:30 경계·KST), 변경 토큰 비교(같음·다름·감소), 시스템 관리자 판정, 내보내기 manifest·CSV 수식 주입 방어
- [ ] 통합:
  - **덤프:** 덤프 → 복호화 → 빈 DB 복원에서 계정·문서·결재 이력·**감사 로그** 행 수 일치, `session`·`verification` 데이터는 복원본에 없음, 해시·크기가 이력과 일치, 변경 없으면 `SKIPPED`, 동시 실행은 한 건만, 실패하면 `FAILED`와 오류 기록·`overdue` 판정, 개인키 없이는 복호화 불가
  - **권한:** 시스템 관리자가 아니면 덤프 API 전부 404(소유자·관리자 포함), 재인증 없이 거부(428), 비활성 설정이면 전체 404
  - **내보내기:** ZIP이 열리고 manifest 해시가 모든 파일과 일치, 타 계정 문서·서명·도장 미포함, 완료되지 않은 문서는 제외·건수 기록, 관리자는 허용 설정 때만 요청, 동시 요청 거부, 만료 후 `EXPIRED`·다운로드 거부, 서명 URL **실제 fetch**, 다운로드마다 감사 로그·재인증
  - **재구성:** 문서가 지워진 DB에서 패키지로 복구되고 해시가 다른 문서는 건너뛰며 보고, 두 번 실행해도 같은 결과(멱등), 문서번호 시리즈 보정
  - **테넌트 격리:** `backup_job`
  - M2~M6 통합 테스트 회귀 없음
- [ ] E2E(데스크톱·360px): 시스템 관리자 수동 덤프·이력·삭제 요청, 계정 내보내기 요청→(worker 없는 E2E 환경이므로 상태 표시까지) 이력, 소유자의 관리자 허용 토글, 권한 없는 사용자 접근 불가
- [ ] 복구 리허설: `backup:rehearse`를 개발 DB·S3로 실행해 문서 수 일치와 패키지 20건 해시 검증 결과를 기록
- [ ] lint · typecheck · 전체 테스트 · `next build`

## 결정 필요
| # | 항목 | 제안 |
|---|---|---|
| Q1 | 덤프 권한 주체 | **시스템 관리자**(`SYSTEM_ADMIN_EMAILS`). 파일럿은 소유자 이메일을 넣는다. 계정 소유자 일반에게 열지 않는다(다중 계정 데이터 포함) |
| Q2 | 덤프 보관 정리 | 앱이 지우지 않고 **버킷 수명 주기**(daily 7일·weekly 28일). 적용은 배포 단계 |
| Q3 | 수동 덤프 "삭제" | 앱은 삭제 권한이 없으므로 **태그(`expire=1`)로 표시**하고 수명 주기가 1일 뒤 삭제 |
| Q4 | `backup_job` 구조 | PRD의 한 테이블을 **`system_backup`(덤프, 계정 없음)과 `backup_job`(계정 내보내기, RLS)** 로 나눈다 |
| Q5 | 내보내기 문서 범위 | **READY 패키지가 있는 완료 문서만**. 그 외는 건수만 기록 |
| Q6 | 내보내기 다운로드 | 보관 7일, **다운로드마다 재인증 + 10분 서명 URL**(PRD의 7일 URL 대신) |
| Q7 | 내보내기 비밀번호 암호화(선택) | 이번에 **제외**(스택 밖 라이브러리 필요, 재인증·짧은 URL로 보호) |
| Q8 | 패키지 형식 | 색인 재구성에 필요한 필드를 `approval.json` **schemaVersion 2**로 추가(파일럿 전이라 지금 확장) |
| Q9 | 새 패키지 | `age-encryption`, `@aws-sdk/lib-storage` (설치 전 검증 결과 보고 후 버전 승인) |
| Q10 | 개인키 보관 | 서버에는 **공개키만**. 개인키는 운영자가 서버 밖에 2부 보관, 복원은 운영자 CLI에서만 |
| Q11 | `session`·`verification` 제외 | 덤프에서 데이터 제외(복원 후 재로그인) |
| Q12 | 실패 알림 | M7은 상태·배지·`backupHealth`까지, **발송은 M8** |

## 위험
| 위험 | 대응 |
|---|---|
| 개인키 분실 → 덤프를 못 엶 | 2부 보관 절차를 이관 문서에 명시, 리허설에서 복호화까지 확인 |
| 색인 재구성이 트리거에 막힘 | A1에서 먼저 확인, 막히면 `SECURITY DEFINER` 함수 + 보안 리뷰 |
| 큰 ZIP·덤프의 시간·디스크 | 스트리밍·임시 파일 정리·작업 제한 시간 5분→1시간, 용량 추정은 DEPLOYMENT_PLAN 4.3(15GB/년) |
| 로컬에서 검증 못 하는 것 | 수명 주기·Object Lock·rclone·실제 age 바이너리 호환 — "미검증"으로 기록하고 스테이징(M8)에서 확인 |
| 변경 토큰이 통계 초기화로 어긋남 | 어긋나면 덤프하는 쪽으로 동작 |

## 결정·변경 기록
- 2026-10-05: 초안 작성 (사용자 검토 대기). 현황은 HEAD `5a14802` 기준 코드·문서 조사 결과이며, 트리거 영향·`approval.json` 필요 필드·컨테이너 안 `pg_dump` 실행은 A1에서 확인

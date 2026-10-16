# 기능 지도 (생성됨 — 직접 고치지 않는다)

`pnpm feature:index`가 각 `features/*/feature.map.yaml`과 코드에서 만든다. 질의: `pnpm feature:find "<말>"`, 영향: `pnpm feature:impact <파일>`.

## account — 로그인(개발용 시드 로그인·Better Auth)·세션, 회사 만들기·전환, 초대 수락, 내 정보(프로필·결재 PIN·세션·로그인 이력)
- 키워드: 로그인, 계정, 세션, 초대, 온보딩, 회사 전환, PIN, 프로필, 서명, 도장, 로그인 이력
- 화면: /login, /dev-login, /invite/[token], /onboarding, /me · API 20개 · 폴더 `features/account/`
- 표: 소유 invitation / 읽기 5개
- 시험: tests/*.test.ts · tests/account.int.test.ts · apps/web/e2e/m1.spec.ts

## approval — 기안·결재선·결재 처리(승인·반려·합의·보류·회수), 위임·부재, 양식 관리, 문서함·검색·수신(참조), 일괄 이관, 문서 내보내기
- 키워드: 결재, 기안, 결재선, 승인, 반려, 합의, 보류, 회수, 대결, 부재, 양식, 문서번호, 문서함, 수신, 참조, 검색, 이관, 첨부, 임시저장
- 화면: /approval/new, /approval/draft/[id], /approval/[id], /approval/pending, /approval/mine, /mailbox, /mailbox/[box], /search, /me/absence, /admin/approvals, /admin/forms, /admin/forms/[id] · API 42개 · 폴더 `features/approval/`
- 표: 소유 approval_action, approval_comment, approval_event, approval_line_template, approval_step, attachment, delegation, doc_number_series, document, document_distribution, document_link, document_recipient, document_recipient_read, document_revision, document_search, document_view, form, form_version, user_form_pref / 읽기 6개
- 시험: tests/*.test.ts · tests/*.int.test.ts · apps/web/e2e/m4.spec.ts, apps/web/e2e/m5.spec.ts

## audit — 감사 로그 조회, 문서 이력 타임라인·인쇄 기록, 월간 접속 기록 점검(AUD-026)
- 키워드: 감사, 로그, 접속 기록, 타임라인, 이력, 인쇄, 월간 점검, 감사인
- 화면: /admin/audit, /admin/audit/review · API 5개 · 폴더 `features/audit/`
- 표: 소유 audit_review / 읽기 3개
- 시험: tests/*.test.ts · tests/audit.int.test.ts · apps/web/e2e/m6.spec.ts

## backup — 시스템 DB 덤프(암호화·S3), 계정 데이터 내보내기, 복구 리허설·DB 색인 재구성 도구
- 키워드: 백업, 덤프, 복구, 리허설, 재색인, 내보내기, 엑셀, CSV, 시스템 관리자, age
- 화면: /system/backups, /admin/backups · API 8개 · 폴더 `features/backup/`
- 표: 소유 backup_job, system_backup / 읽기 16개 / 쓰기 예외 8개
- 시험: tests/*.test.ts · tests/*.int.test.ts · apps/web/e2e/m7.spec.ts

## completion — 완료된 결재 문서의 PDF·패키지(final/)를 한 번만 만들어 S3에 쓰고, 열람 권한자에게 내려받게 한다
- 키워드: 완료, PDF, 패키지, 내려받기, ZIP, 인쇄, final, 해시, manifest
- 화면: (없음) · API 3개 · 폴더 `features/completion/`
- 표: 소유 document_package / 읽기 10개
- 시험: tests/*.test.ts · tests/*.int.test.ts · apps/web/e2e (m5.spec.ts가 완료 파일을 거친다)

## home — 로그인 후 첫 화면 — 내 결재 대기·기안 현황과 양식 바로가기
- 키워드: 홈, 대시보드, 첫 화면, 바로가기, 결재 대기
- 화면: / · API 0개 · 폴더 `features/home/`
- 표: 소유 (없음)
- 시험: apps/web/e2e (smoke·m1~m8이 홈을 거친다)

## notification — 결재 이벤트를 인앱·텔레그램 알림으로 바꾸고, 월간 점검 누락·덤프 문제 같은 운영 알림을 보낸다
- 키워드: 알림, 벨, 읽음, 텔레그램, 연결, 수신 방식, 웹훅, 폴링, 운영 알림
- 화면: /notifications, /system/telegram · API 10개 · 폴더 `features/notification/`
- 표: 소유 event_notified, notification, system_setting, telegram_link, telegram_link_token / 읽기 7개
- 시험: tests/*.test.ts · tests/*.int.test.ts · apps/web/e2e/m8.spec.ts

## org — 사업자·부서·직위·직책·구성원·소속(겸직)·역할 부여, 조직도, 부서 CSV 가져오기·내보내기
- 키워드: 조직, 조직도, 부서, 사업자, 직위, 직책, 구성원, 겸직, 발령, 역할, 권한, 초대, 부서 CSV
- 화면: /org, /admin/settings, /admin/businesses, /admin/org, /admin/members, /admin/positions · API 24개 · 폴더 `features/org/`
- 표: 소유 assignment, assignment_history, business, department, duty, position, role_grant / 읽기 2개
- 시험: tests/*.test.ts · tests/org.int.test.ts, tests/org-db.int.test.ts · apps/web/e2e/m2.spec.ts

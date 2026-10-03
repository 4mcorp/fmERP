---
title: M5 완료 처리·문서함 상세 계획
date: 2026-10-04
status: accepted
tags: [approval, storage, worker, pdf, db, api, ui, search, security, test]
related: [docs/plan/2026-10-03-mvp-roadmap.md, docs/plan/2026-10-03-m4-forms-drafting-approval-ui.md, docs/rules/storage-backup.md, docs/rules/architecture.md, docs/adr/0007, docs/adr/0008, APV-063, APV-064, APV-070, APV-072, APV-073, APV-080, APV-081, APV-082, APV-083, BAK-002, BAK-003, BAK-004, BAK-008, PERM-003, ADM-005]
---

## 목표
결재가 끝난 문서를 **PDF와 완료 패키지(S3 `final/`, 한 번만 쓰기)로 확정**하고, 사람들이 **문서함·검색·내보내기로 찾아 열람**할 수 있게 한다. 수신·공람·참조와 열람 권한(PERM-003)을 한 곳의 판정 함수로 통합하고, M2·M4에서 미룬 진행 중 결재 검사·일괄 이관(ORG-036, ADM-005)을 마무리한다.

## 범위
**포함 (P0)**: APV-063, APV-064(outbox 소비와 ERP 모듈 구독 인터페이스까지), APV-070, APV-072, APV-073, APV-080~083, BAK-002(M4 구현분 유지), BAK-003, BAK-004(앱 키에 삭제 권한 없음 + 쓰기 거부까지), BAK-008, PERM-003, ADM-005, ORG-036.

**M4에서 이월**: `in-flight.ts` 스텁(ORG-005·015·036), `routes/approvals.ts`의 인라인 참여자 판정, `document_recipient`, M4 plan 보류(낮음) 항목은 이 plan에서 다루지 않는다.

**제외**: 반송(APV-071, P1), 웹훅 HTTP 전달(API-003·ADM-008, P1), 부서 문서함 열람 권한의 양식별 설정(PERM-004, P1), 문서 열람 감사 로그(AUD-028, P1), 알림 발송(M8), 감사인 화면·이력 타임라인·월간 점검(M6), 덤프·계정 내보내기·색인 재구성 스크립트(M7, 단 패키지 형식은 M7 입력이므로 여기서 확정), 운영 compose·스테이징(M8).

## 사전 확인 — 적용할 트러블슈팅
| ts | 적용 |
|---|---|
| s3-presigned-checksum | S3 클라이언트는 `packages/storage`에서만 만들고 체크섬 옵션 `WHEN_REQUIRED` 유지. 문서 다운로드 서명 URL은 실제 fetch까지 통합 테스트 |
| pgboss-schema-permission | worker가 새 역할·권한을 쓰면 initdb 변경은 기존 볼륨에 반영되지 않음을 전제로 직접 적용 |
| next-monorepo-env-and-bundling | PDF 템플릿·폰트를 공유 패키지에 두면 웹 번들에서 경로 코드가 깨지지 않게 별도 `exports`로 분리 |
| drizzle-composite-fk-migration-order | `document_recipient` 등 복합 FK 마이그레이션은 생성 SQL 순서 확인 후 적용. 적용된 마이그레이션은 수정하지 않음 |
| e2e-dev-server · playwright-label-region… | 문서함 표·행 동작 E2E는 role·aria-label로 찾고 `@stateful` 태그 |
| e2e-fix-loop-and-controlled-folder-access | 실패한 테스트만 재실행, 전체는 단계 끝에 1회, 같은 실패 3회면 멈추고 보고, 단계마다 커밋 |

## 설계
### 1. 완료 이벤트 소비 (APV-064)
- 엔진이 같은 트랜잭션에 쓰는 `approval_event`(outbox)는 UPDATE 권한과 소비 표시 열이 없고 소비자도 없다.
- **제안(Q3)**: 상태 열이 있는 소비 큐를 pg-boss로 구현한다. 완료 트랜잭션이 끝난 뒤 web이 작업을 등록하고, **누락 보정용 스윕**(패키지 미생성 완료 문서를 주기적으로 찾아 재등록)을 worker가 돈다. 작업은 멱등이어야 한다.
- ERP 모듈 구독은 인터페이스(이벤트 타입·페이로드)까지만. 외부 웹훅 전달은 제외.

### 2. 결재 PDF와 완료 패키지 (APV-063, BAK-003·004)
- **worker**(`apps/worker`)가 생성한다. web은 큐 등록만 한다 (architecture.md).
- 엔진: Playwright `page.pdf()` + Pretendard. worker 이미지는 `mcr.microsoft.com/playwright:v1.63.0-noble`(npm 버전과 일치), 메모리 2GB. Dockerfile 초안을 이 단계에서 만든다 (로드맵 위험 "한글 PDF").
- 결재란: 직위·성명·서명 또는 도장·일시, 문서번호. 대결은 "대결 OOO"로 표기. 서명·도장은 `user.signatureKey`·`stampKey` 사용. 레이아웃은 `form_version.layout`(APV-007)의 결재란 위치·용지 방향까지 반영.
- `final/{document.pdf, document.json, approval.json, manifest.json}`를 `putIfAbsent`로 한 번만 쓴다. 이미 있으면 **해시를 비교해 같으면 성공, 다르면 실패**로 처리한다(Q3).
- `approval.json`: 결재선, 단계별 처리자·대결 여부·일시·IP·의견, 문서번호, 상신 `content_hash`, 파일별 SHA-256. `manifest.json`: 패키지 파일의 경로·크기·SHA-256.
- 첨부(Q5): **복사하지 않고** `approval.json`/`manifest.json`에 첨부의 S3 키·SHA-256을 참조로 적는다. 복사는 저장 비용이 2배가 되고 `final/` 불변 의미가 없다.
- 후결(Q4): 완료 시점의 후결 대기는 `approval.json`에 "대기"로 기록하고, 이후 후결 승인은 `final/`이 아닌 **별도 키 `post-approvals/`**에 한 건씩 `putIfAbsent`로 쓴다. 이 구조는 M7 색인 재구성(BAK-010) 입력이 되므로 `storage-backup.md`를 같은 커밋에서 갱신한다.
- 패키지 상태: `document`에 열이 아니라 별도 테이블 `document_package`(status, 시도 횟수, 마지막 오류, 패키지 해시, 생성 시각). 문서는 COMPLETED여도 패키지는 PENDING일 수 있고 화면에 "PDF 생성 중"으로 표시한다.
- BAK-004: `packages/storage`에는 삭제 메서드가 없는 현재 상태를 유지하고 `final/` 덮어쓰기 거부 테스트를 추가한다. **Object Lock·Bucket Lock 적용은 Q1의 공급자 확정 뒤 배포 단계**에서 한다 (로컬 SeaweedFS에서는 검증 불가).

### 3. 열람 권한 (PERM-003)
- `isParticipant`와 `routes/approvals.ts`의 인라인 판정을 하나의 `canViewDocument`로 합친다. 순수 판정은 `packages/core`, DB 조회는 서버 어댑터에 둔다.
- 열람 = 결재선 참여자 ∪ 참조자 ∪ 수신 부서원(접수 후) ∪ 공람 대상 ∪ `document.read_all` 보유자(소유자·감사인) ∪ 별도 부여자. 보안 등급이 대외비 이상이면 수신 부서는 **접수자만**.
- "별도 열람 권한 부여자"(Q9)는 부여 UI·테이블 정의가 PRD에 없으므로 **M5에서 제외**하고 판정 함수에 확장 지점만 둔다. 감사인 범위 판정과 화면은 M6.
- 관리자(`approval.manage`)는 본문을 열람할 수 없다 (매트릭스 각주).

### 4. 수신·공람·참조 (APV-070·072·073)
- `document_recipient`(document_id, kind: cc·receive·circulate, target 유형·ID, read_at, received_by, distributed_to)를 RLS와 함께 추가한다.
- 지정 위치(Q8): 기안 화면에 지정 UI를 추가하고 `form_version.recipients` 기본값을 반영한다.
- 참조자는 상신 즉시 또는 완료 시(양식 설정)부터 열람. 수신은 부서의 부서장 또는 지정 담당자가 **접수**한 뒤 부서원에게 **배부**. 공람은 대상별 열람 일시를 기록한다.
- 결재선 `type` enum은 건드리지 않는다 (엔진 밖).

### 5. 문서함·검색·내보내기 (APV-080~083)
- 개인 문서함: 결재 대기·결재 예정·진행 중·기안함·완료함·참조함·수신함·공람함·후결·후열함. 부서 문서함과 감사함. 정의는 아래 Q10의 제안을 따른다.
- 모든 목록은 **커서 페이지네이션**과 인덱스로 NFR-P03(10만 건 1초)을 만족하게 하고, `listMyDocuments`의 limit 200을 대체한다.
- 검색(Q7): 제목·문서번호·기안자·기안 부서·양식·기간·상태·첨부 파일명은 DB 열/조인과 `pg_trgm` GIN. **본문은 S3에만 있으므로 상신 시점에 본문 텍스트를 추출해 `document_search`(document_id, text)에 저장**하고 GIN을 건다. 임시저장 본문은 색인하지 않는다. 금액 범위는 양식 필드 중 "금액 필드"로 지정된 값을 상신 시 숫자 열로 복사한다(지정 규칙은 양식 빌더에 필드 속성 하나를 추가). 3글자 미만 검색어는 접두 일치로 처리한다. 결과는 `canViewDocument`로 필터링한다.
- 내보내기(Q12): CSV·엑셀, 열람 가능한 문서만, **행 수 상한**(제안: 10,000행), 상한 이내는 동기 응답·초과는 거부(재조건 입력). 셀 값이 `= + - @`로 시작하면 앞에 `'`를 붙여 수식 주입을 막는다. 모든 내보내기는 감사 로그에 기록.
- 문서 다운로드(BAK-008, Q6): PDF는 권한 확인 후 서명 URL, **패키지 ZIP은 요청 시 스트리밍**(첨부 포함). 둘 다 감사 로그. 재인증은 ZIP에만 요구한다.

### 6. 퇴사·이관 (ADM-005, ORG-036)
- `in-flight.ts` 스텁을 실제 쿼리로 교체(사업자·부서·구성원 단위). M2 테스트의 기대가 바뀌는 부분은 같은 커밋에서 고친다.
- 일괄 이관: 대상 구성원의 진행 중 단계 처리자를 대체 결재자로 교체. 입력은 대상·대체자·사유(필수), 재인증 필요, 감사 로그. 현재 `approval_step_guard` 트리거가 ACTIVE 단계의 처리자 교체를 막으면 **이관 전용 예외**를 마이그레이션으로 추가한다(Q11, 보안 리뷰 대상).
- 퇴사·휴직 처리는 진행 중 결재가 있으면 **경고하고 이관 후에만 진행**(PRD 문구 "경고하고 이관"을 이관 선행으로 해석).
- 장기 미처리 목록: 기준은 계정 정책의 일수(제안 기본 7일), 관리 콘솔의 결재 문서 관리 화면.

### 7. 새 패키지 (TECH_SPEC에 확정, `dependencies.md` 절차·승인 필요)
- `write-excel-file ~4.1.1`, `archiver ~8.0.0`. (TECH_CANDIDATES의 exceljs 표기는 구판이며 TECH_SPEC을 따른다.)
- worker: `@fmerp/*` 패키지 의존과 S3 환경 변수 추가, Playwright(루트와 같은 1.63).

## 단계 (4개 하위 단계, 태스크마다 커밋·푸시, 단계 끝에 전체 검증)
**M5-A 서버·규칙**
- [ ] A1. 패키지 검증(설치는 쓰는 단계에서), ADR 0009(완료 패키지 형식·`post-approvals/`·`document_package` 상태·검색 색인), 패키지 형식을 `storage-backup.md`에 반영
- [ ] A2. core(TDD): `canViewDocument`, 수신 접수·배부 규칙, 이관 규칙
- [ ] A3. DB: `document_package`, `document_recipient`, `document_search`, 금액 열, 인덱스, 트리거 예외, 권한 GRANT, RLS
- [ ] A4. 서버: 열람 판정 통합, 수신·공람·참조 API, 문서함 API(커서), 검색 API, 이관·미처리 목록 API, `in-flight` 실제 쿼리, 감사 로그
- [ ] A5. 통합 테스트·보안 점검

**M5-B worker·PDF·패키지**
- [ ] B1. worker 이미지·Dockerfile 초안, 폰트, PDF 템플릿, 샘플 7종으로 한글 PDF 시각 확인
- [ ] B2. 완료 이벤트 큐·스윕·멱등, `final/` 패키지 쓰기, 실패·재시도
- [ ] B3. 문서 다운로드(PDF 서명 URL, ZIP 스트리밍), 통합 테스트(`final/` 덮어쓰기 거부 포함)

**M5-C 문서함·검색·내보내기 화면**
- [ ] C1. 사이드 메뉴·문서함 화면(개인·부서), 검색 화면, 페이지네이션
- [ ] C2. 내보내기(CSV·엑셀), 문서 다운로드 UI, "PDF 생성 중" 표시

**M5-D 수신·공람·이관 화면**
- [ ] D1. 기안 화면 수신·공람·참조 지정, 수신함 접수·배부, 공람 열람 표시
- [ ] D2. 결재 문서 관리(일괄 이관·미처리 목록), 퇴사·휴직 경고 연결
- [ ] D3. E2E(완료 → PDF·패키지, 문서함·검색, 수신 접수·배부·공람, 이관), `web-design-guidelines` 점검, 보안 리뷰, 문서 정리

## 완료 기준
- [ ] 단위: `canViewDocument`(참여자·참조·수신 접수 전후·공람·감사인·소유자·관리자 불가·대외비 수신), 이관 규칙
- [ ] 통합:
  - **패키지:** 완료하면 `final/` 4개 파일과 해시가 맞는 manifest, 같은 키에 다시 쓰면 거부(같은 해시 재실행은 성공), 앱 키에 삭제 수단 없음, 패키지 생성 실패 후 스윕이 재시도
  - **권한:** 타 계정·무권한 사용자의 문서·PDF·ZIP·검색 결과 접근 불가(404), 대외비 수신은 접수자만
  - **검색:** 본문·첨부 파일명·금액 범위·기간 검색이 열람 권한으로 필터링됨, 10만 건 시드에서 문서함·검색 1초 이내
  - **내보내기:** 열람 가능한 문서만, 상한 초과 거부, 수식 주입 방어, 감사 로그
  - **이관:** 진행 중 결재가 있는 퇴사 거부, 일괄 이관은 사유·재인증·감사 로그, 처리된 단계 보호
  - **테넌트 격리:** 신규 테이블 전부
  - M2·M3·M4 통합 테스트 회귀 없음
- [ ] E2E(데스크톱·360px 모바일): 완료 → PDF 링크 → 다운로드, 문서함 이동·검색, 수신 접수·배부, 공람 열람 표시, 일괄 이관
- [ ] lint · typecheck · 전체 테스트 · `next build`
- [ ] 한글 PDF 샘플 7종 시각 확인 결과를 기록 (검증하지 못한 부분은 그대로 적는다)

## 결정 필요
| # | 항목 | 제안 |
|---|---|---|
| Q1 | 버킷 공급자·보관 위치 (PRD 오픈 이슈 Q4) | **AWS S3 서울(ap-northeast-2)로 확정.** 운영은 서버 밖 S3, 로컬 SeaweedFS는 개발·테스트 전용. 버킷은 Object Lock(버전 관리 포함)을 켜서 만들고 `final/`에 보존 기간 적용은 배포 단계에서 한다 |
| Q2 | APV-064 범위 | outbox 소비와 구독 인터페이스까지. 외부 웹훅 HTTP 전달은 제외(P1) |
| Q3 | 이벤트 소비·멱등 | pg-boss 큐 + 누락 보정 스윕. `final/`이 이미 있으면 해시 비교로 멱등 처리 |
| Q4 | 후결·패키지 상태 | 상태는 별도 테이블 `document_package`, 후결 승인은 `post-approvals/`에 한 건씩 기록 |
| Q5 | 첨부와 패키지 | 복사하지 않고 `approval.json`·`manifest.json`에서 키·SHA-256 참조 |
| Q6 | ZIP·재인증 | 요청 시 스트리밍, 첨부 포함, 재인증은 ZIP에만 |
| Q7 | 본문 전문 검색 | 상신 시 본문 텍스트를 `document_search`에 저장 + `pg_trgm` GIN, 임시저장은 제외, 금액 필드 지정 속성 추가 |
| Q8 | 수신·공람·참조 지정 | 기안 화면에 지정 UI 추가, `form_version.recipients` 기본값 반영. 수신 담당자는 부서장 또는 지정 담당자 |
| Q9 | 열람 권한 | `canViewDocument` 통합, 감사인 범위 판정 지점만 M5, "별도 열람 권한 부여"는 제외 |
| Q10 | 문서함 정의 | 결재 예정=내 차례가 아직 안 온 단계, 진행 중=내가 관여한 미완료 문서, 후결·후열함=후결 대기·대결로 처리된 원 결재자 사후 열람. 부서 문서함은 부서원 전체(권한 설정은 PERM-004, P1) |
| Q11 | 이관·퇴사 | 이관 선행, 이관 전용 트리거 예외 추가(보안 리뷰), 미처리 기준 7일 |
| Q12 | 내보내기 | 최대 10,000행 동기, 수식 주입 방어, 열람 가능 문서만 |
| Q13 | worker 이미지·운영 compose | worker Dockerfile 초안까지 M5, 운영 compose·스테이징은 M8 |
| Q14 | 새 패키지 | `write-excel-file`, `archiver` (7절). 설치 전 검증 결과 보고 후 버전 승인 |

## 결정·변경 기록
- 2026-10-04: 초안 작성 (사용자 검토 대기). 현황은 HEAD `8df0277` 기준 조사 결과이며, `in-flight.ts` 스텁 여부·`approval_step_guard`의 ACTIVE 단계 처리자 교체 제한은 코드 확인이 필요한 항목(A3·A4 착수 때 먼저 확인)
- 2026-10-04: 사용자 승인 — Q2~Q14 제안안대로 승인(Q14 패키지는 설치 전 검증 결과를 보고한 뒤 버전 확정). Q1은 S3 서울로 확정. 로컬 저장은 검토했으나 월 $0.5 미만의 비용 이득뿐이고 서버 밖 보관 원칙(DEPLOYMENT_PLAN 2장)·삭제 불가 보존(BAK-004)을 약하게 만들어 채택하지 않음. 기준 문서(PRD 오픈 이슈 Q4, DEPLOYMENT_PLAN 2.3·선행 작업)의 반영은 별도 승인 후 수정

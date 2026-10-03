---
status: accepted
---

# 완료 패키지는 manifest를 마지막에 쓰는 한 번만 쓰기 구조, 후결은 `post-approvals/`, 검색은 상신 시 본문 텍스트 색인

- **패키지 생성은 worker**가 한다. 결재 완료 트랜잭션이 끝난 뒤 web이 pg-boss 작업(`approval.completed`)을 등록하고, worker가 주기적으로 **패키지가 없는 완료 문서를 찾아 다시 등록하는 스윕**을 돈다(등록 실패 보정). 스윕은 계정 경계를 넘어 문서 ID만 읽으므로 RLS를 우회하는 `SECURITY DEFINER` 함수 하나(문서 ID·계정 ID만 반환)로 제한하고, 그 뒤의 실제 처리는 계정별 `withTenant`로 한다.
- **`final/`은 `document.json` → `approval.json` → `document.pdf` → `manifest.json` 순으로 `putIfAbsent`** 한다. `manifest.json`이 있으면 패키지가 완성된 것이다(커밋 표시). 재시도할 때 이미 있는 객체는 **해시를 확인**한다: JSON은 다시 만든 내용과 같아야 하고, PDF는 Chromium이 만들 때마다 바이트가 달라지므로 다시 만들지 않고 **기존 PDF를 그대로 채택**해 manifest에 해시를 적는다. JSON이 다르면 `FAILED`로 두고 사람이 확인한다(덮어쓰지 않는다).
- **`approval.json`**: 결재선, 단계별 처리자·대결 여부·일시·IP·의견, 문서번호, 상신 `content_hash`, 완료 시점의 후결 대기 단계. **`manifest.json`**: `document.json`·`approval.json`·`document.pdf`의 경로·크기·SHA-256과, **첨부는 복사하지 않고 S3 키·크기·SHA-256 참조**로 적는다(첨부는 이미 `attachments/`에 불변으로 있다).
- **후결 승인은 완료 이후에 일어나므로** `final/`에 쓸 수 없다. `docs/.../{문서ID}/post-approvals/{단계ID}.json`에 한 건씩 `putIfAbsent`한다(처리자·일시·IP·의견·해시). `final/`은 변하지 않는다.
- **`document_package`**(문서, 상태 `PENDING`·`READY`·`FAILED`, 시도 횟수, 마지막 오류, manifest 해시, 시각)가 생성 상태를 가진다. `document`에 열을 더하지 않는다(완료 후 불변 트리거와 분리). `READY`가 된 행의 manifest 해시는 트리거로 바꿀 수 없다. 화면은 `PENDING`이면 "PDF 생성 중"을 보인다.
- **열람 판정은 `canViewDocument` 하나**(core의 순수 판정 + 서버의 조회 어댑터)로 통합한다. 결재선 참여자 ∪ 참조 ∪ 수신(접수 후, 대외비 이상은 접수자만) ∪ 공람 ∪ `document.read_all`(소유자·감사인) 으로 하고, 관리자(`approval.manage`)는 본문을 열람할 수 없다. "별도 열람 권한 부여"는 M5에서 만들지 않는다.
- **수신·공람·참조**는 `document_recipient`(kind `cc`·`receive`·`circulate`, 대상, 열람·접수·배부 기록)로 둔다. 결재선 `type`에는 넣지 않는다(엔진 밖).
- **검색**: 본문은 S3에만 있으므로 **상신할 때 본문 텍스트를 추출해 `document_search`에 저장**하고 `pg_trgm` GIN을 건다(임시저장은 색인하지 않고, 회수 후 재상신하면 다시 만든다). 금액 범위는 양식 필드에 "금액 필드" 속성을 두고 상신할 때 값을 `document.amount`(원 단위 `bigint`, ADR 0002)로 복사한다. 3글자 미만 검색어는 접두 일치. 결과는 `canViewDocument`로 거른다.
- **내보내기**: 열람 가능한 문서만, 10,000행 상한 동기 응답, `= + - @`로 시작하는 셀은 앞에 `'`를 붙인다. 패키지 ZIP은 요청 시 스트리밍하고 재인증을 요구한다.
- **패키지**: `write-excel-file`(MIT, 2026-06 배포)·`archiver`(MIT, 2026-05 배포)는 peer 의존성 없음. 설치는 쓰는 단계에서 한다.
- 패키지 형식이 M7의 색인 재구성 스크립트(BAK-010)의 입력이므로 [storage-backup.md](../rules/storage-backup.md)를 같은 커밋에서 갱신한다.

**Considered Options:** 패키지 상태를 `document` 열로 두기(완료 후 불변 트리거 예외가 늘어남), 첨부를 `final/`로 복사(저장 2배, 불변 의미 없음), 후결을 `approval.json`에 이어쓰기(`final/` 한 번만 쓰기 위반), PDF를 재시도 때마다 재생성해 해시 비교(Chromium PDF는 결정적이지 않음), 본문 검색을 S3 스캔으로 처리(10만 건 1초 불가), 완료 시 outbox만 폴링(소비 상태·권한 열이 없고 RLS 때문에 worker가 계정별로 읽기 어려움).

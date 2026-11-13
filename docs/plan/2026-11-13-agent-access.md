---
title: 개인 에이전트 토큰·MCP 접근 구현 계획
date: 2026-11-13
status: proposed
tags: [agent, mcp, auth, security, approval, org]
related: [docs/adr/0013-agent-access-model.md, AUTH-009, APV-043, PERM-001, AUD-020]
---

# 에이전트 접근 구현 계획

## 1. 범위와 상태

[ADR 0013](../adr/0013-agent-access-model.md)을 구현 기준으로 삼는다. 이번 A는 문서만 작성한다. 개인 토큰·MCP·승인 큐는 아직 없다. ADR은 proposed로 유지하며 B~G는 이 제안에 따라 착수할 수 있다. 사용자 승인 전 운영 노출과 accepted 전환은 하지 않는다.

원안의 '허용'은 사용자 권한과 scope 교집합을 통과한 도구만 뜻한다. HTTP 경로를 통째로 프록시하지 않는다. `read/write/confirm` 도구 레지스트리가 실행을 제한하며 미분류·새 API는 기본 제외다. 아래 표는 기존 API의 method/path를 `docs/feature-map/index.json`과 대조한 근거다. prefix `/api`는 생략한다. `{userId}`는 사용자 id이고 `membershipId`와 혼용하지 않는다.

## 2. 원안 보정

| 원안 또는 누락 | 보정과 이유 |
|---|---|
| `/members/{id}/assignment-history`, `/identity-history`, `/assignments`, `/roles` | 모두 `/account/members/{userId}/...`다. 역할 회수는 `DELETE /account/members/{userId}/roles/{grantId}` |
| `DELETE /approval-line-templates`, `DELETE /departments`, `DELETE /account/invitations` | 각각 `/{id}`가 필요하다. 부서 이동은 `POST /departments/{id}/move` |
| 양식 버전 게시가 허용/확인에 중복 | `POST /forms/{id}/versions`는 confirm 하나로 분류 |
| 부서 삭제가 허용/확인에 중복 | `DELETE /departments/{id}`는 confirm 하나로 분류 |
| `PUT /approvals/{id}/line` 허용 | 진행 중 결재선 변경이며 PIN 재인증을 요구한다. **제외**. 본인 초안의 `/draft-line`만 write |
| `POST /approvals`를 초안 생성으로만 해석 | 기존 입력은 `submit=true`로 즉시 상신 가능. MCP 초안 스키마는 submit 인자를 허용하지 않고 서버가 false로 강제한다. 상신은 별도 confirm 제안 |
| `PATCH /account/members/{userId}`의 '이름·사번 외' | 실제 입력은 status/name/email. 사번 입력 자체가 없고 이메일은 전역 사용자 정보다. MCP는 **status만 confirm 제안**, name/email/employeeNo는 제외. 무해한 쓰기 필드가 남는 것처럼 구현하지 않는다 |
| 초대 생성 직접 허용 | `role=admin` 권한 상승과 평문 초대 링크 외부 유출 가능. 생성/폐기를 confirm으로 옮기고 링크는 웹에서만 1회 표시. MCP에는 id·상태만 반환 |
| 사용자 단건 GET 도구 | 단건 API는 없다. `members_get`은 권한·필드 제한을 적용한 목록/공개 조회 서비스에서 id로 찾는 도구다. 가상의 GET 경로를 추가하지 않는다 |
| 상신·회수·reopen | `documents-routes.ts:265-293`의 동적 라우트여서 생성 지도에 누락. 아래 별도 실코드 근거 표로 분리. 존재하지 않는 API로 표기하지 않는다 |
| 내보내기 일괄 제외와 양식 export 허용 충돌 | 양식 **정의 JSON**만 `forms.read`로 예외 허용. 문서 검색 export·계정 export·부서 CSV export는 제외 |
| 인쇄 미리보기·첨부 목록 | HTML의 서명/도장 이미지·서명 URL은 MCP 출력에서 제거. 첨부는 id·허용 메타데이터만, S3 key/URL/원본은 반환 금지 |
| `PUT .../recipients` | 초안 소유자에게만 write. 진행 중/완료 문서 수신처 변경은 제외. 댓글은 별도 scope·기존 공개 범위 유지 |
| 양식 생성·복제/import | 어떤 경로도 활성화/게시를 동반해서는 안 됨. 기존 서비스가 비활성을 강제하지 않는 경우 C에서 같은 서비스의 원자적 비활성 생성 계약을 마련. 생성 후 별도 비활성화하는 보상 방식 금지 |
| 위임·일괄 이관 | GET delegations는 org.read로 허용, 생성/폐기와 이관은 confirm. 변경 대상·범위는 기존 권한 규칙 그대로 |
| 미분류 API | 즐겨찾기·재기안·공람·수신/배포·설정 변경·사업자 변경·부서 import·알림 등은 이번 범위 밖이므로 기본 제외 |

`GET /account/members`는 현재 과거 이름·메일과 grants까지 반환한다. MCP `org.read` 응답은 최소 구성원 정보로 축소하고 과거 개인정보는 `org.history.read`와 기존 이력 조회 권한을 함께 요구한다. `GET /account/capabilities`는 UI 표시 정보이지 도구 실행 권한 증명이 아니다. `GET /approvals/{id}`는 읽음/열람 기록을 남길 수 있으므로 '조회가 무부수효과'라고 설명하지 않는다.

## 3. B~G 구현 순서와 인수 기준

실제 카드 그래프는 **A → B → C·D·E → F → G**다. 같은 worker가 각 카드를 구현·자가검증·PR/CI까지 맡는다. B의 PR이 dev에 반영된 뒤 C~E가 최신 origin/dev에서 시작한다. C~E가 같은 registry 파일을 수정할 수 있으므로 각 기능 공개 진입점은 기능 소유, 합성 레지스트리는 apps/mcp 소유로 정하고 직렬 반영한다. 충돌이 보이면 hotspot 코멘트를 남긴다.

### B. 기반 (`t_cfc0c785`)

- account 소유 `agent_token`, `agent_pending_action`, 공통 감사 필드의 신규 마이그레이션·FK·RLS·최소 권한 인증 조회 경계. 감사의 소유 기능 shared 유지. `/me` 발급/폐기 UI, 발급 재인증·평문 1회 표시·no-store.
- 독립 `apps/mcp`에서 Hono와 기능 공개 서비스 재사용. SDK는 dependencies 규칙에 따라 라이선스·최근 배포·버전 문서 확인 및 승인 후 실제 import하는 카드에서만 추가. API key 패키지는 기본안에서 추가하지 않는다.
- 단일 레지스트리, request id, HTTP/MCP 오류 분리, Origin/Host·입력/응답 크기·공유 속도 제한·SSE 폐기. 웹 API는 agent bearer를 수용하지 않음.
- 승인 대기 웹 큐와 상태 CAS·payload 해시·revision·멱등 실행·S3 payload·엄격한 웹 PIN 재인증 기반. confirm 실행은 웹만 가능.
- 샘플 `whoami`와 `list_forms`로 실제 initialize→tools/list→tools/call 확인. B 샘플 이름과 C의 `forms_list`는 중복 도구로 남기지 않는다. C에서는 `forms_list` 하나로 정리하고 가이드를 맞춘다.
- **인수 기준**. 무토큰/만료/폐기/휴직/탈퇴/권한 회수/scope 부족/다른 계정 404 시험, 평문·해시·PIN 로그 부재, 재발급·웹 인증 우회 불가, 동시 폐기/쓰기, SSE 재연결, 다중 인스턴스 429, 감사 실패 롤백을 통합 시험한다. pending 승인/거절/만료/stale·중복 실행·타인 승인·다른 token id 재사용 거부를 검증한다. feature map·파일 배정·arch 검사 위반 0건.

### C. 양식 (`t_9d1e0905`)

- `forms_list/get/get_draft/export/describe_schema`, `forms_create_draft/update_draft/duplicate/import`, `line_templates_list/create/delete`, `forms_publish_version` 제안.
- 기존 양식/블록 Zod 스키마·작성자별 draft revision CAS 재사용. 표준 사용자 읽기 권한은 기존 API에 맞추고 쓰기는 `form.manage`와 scope 교집합. 관리자가 아니라는 이유로 정상 기안용 양식 읽기까지 임의 차단하지 않는다.
- **인수 기준**. 일반 구성원 쓰기 거부·사업자 범위·타 계정 404, 비활성 생성/복제/import 보장, 버전 게시는 pending만 생성, 사람 확정 전 기존 최신 버전 불변, revision 충돌 409. 결재선 템플릿의 소유권·전체 공개 여부 보존. 스키마 확장과 표시 3경로 변경 없음. 도구 계약·통합 시험.

### D. 기안 (`t_187da1c7`)

- inbox/mailbox/search/get/timeline, 결재선 후보 조회, 본인 초안 생성/저장/결재선/수신처와 공개 범위 댓글. `documents_submit`은 제안만 생성.
- **인수 기준**. create에서 submit 주입 거부/false 강제, line(PIN 경로)·act·첨부 URL·완료 파일 도구 부재, 본인 초안만 수정·완료 409·타 계정 404. 기존 requireView/수신·댓글 공개 범위·감사·내용 해시 유지. 사람 확정 시 본문·결재선·수신처 변경은 stale, 중복 상신은 한 번. 실제 동적 submit 경로/서비스를 재사용하되 PIN은 웹에서만 검사. 미리보기의 서명/도장·URL 제거와 목록의 출력 상한을 계약 시험.

### E. 사용자·조직 (`t_5a06992c`)

- org/members/businesses/departments/settings/capabilities·이력 조회, 부서 생성/수정/이동·소속 변경. 부서 active=false가 삭제/폐지와 같은 영향을 내면 confirm으로 분기하며 일반 update로 우회하지 못하게 한다.
- status 변경·역할 부여/회수·부서 삭제·위임 생성/폐기·일괄 이관·초대 생성/폐기는 제안만. 초대 평문은 사람만 수령. member name/email/employeeNo·enrollment/복구·이미지는 제외.
- **인수 기준**. 사업자 관리자의 계정 역할·타 사업자 변경 거부, 마지막 소유자·전역 사용자 보호·부서 뎁스 보존, 소속 이력·감사·agent 추적 유지. 과거 이름/메일은 scope와 관리 권한 없는 응답에서 제거. 관리자 초대 직접 실행·평문 반환 불가. 도구 계약·타 계정 404·진행 결재 연관 부서 검사·confirm 우회 필드 거부 통합 시험.

### F. 가이드 (`t_58011f9f`)

- 카드에 지정된 세 SKILL과 `docs/ops/agent-mcp.md`, 비밀 없는 환경변수 참조 예시를 작성한다. 실제 구현 레지스트리의 도구명을 정본으로 삼는다.
- **인수 기준**. 가이드 도구명이 레지스트리와 일치하는 자동 검사, Claude/Hermes/Codex 중 수동 Bearer 지원이 확인된 설정만 실행 검증과 함께 기재. OAuth 전용 클라이언트 미지원 명시. initialize·토큰 발급/폐기·상신 pending→웹 확인 절차를 재현. 인증값은 채팅·Git에 넣지 않는다. 화면/도구 응답의 '제안 생성됨'을 '상신 완료'로 쓰지 않는다.

### G. 최종 검증 (`t_9026688a`)

- differential-review·semgrep 및 같은 worker의 적대적 검증. 권한·RLS·SSRF·프롬프트 인젝션·다중 인스턴스 제한·비밀 유출·pending 재생/TOCTOU·감사 누락을 검사한다.
- **인수 기준**. k3s 격리 DB/S3에서 전체 관련 단위·통합·E2E, 1280/360px 실제 토큰 발급→양식 초안→기안→pending→사람 PIN 확정, token 폐기 즉시 거부. 이 계획의 제외 API는 모두 MCP registry/호출 불가를 검증하고 raw path 인자도 거부. 원격 exact-head 필수 CI 녹색과 `pnpm verify` 통과. 실패는 같은 러너·깨끗한 최신 dev 기준선과 대조한다. 결과는 별도 review 계획 문서/INDEX에 남긴다. 사용자 승인 없이는 ADR accepted로 바꾸지 않는다.

각 구현 카드의 공통 종료 조건은 typecheck·lint·관련 시험·arch:check와 실제 PR exact-head CI다. 새 마이그레이션은 적용된 파일 수정 없이 생성하며 개발 서버 기동 전 migrate한다. 새로운 제한을 기준선·억제 주석에 넣어 우회하지 않는다.

## 4. 위험·미정 사항

| 항목 | 현재 결정/해결 시점 |
|---|---|
| 토큰 유출·에이전트 과잉 행동 | 짧은 만료·최소 scope·즉시 폐기·allowlist. read도 본문 유출 위험이 있어 발급 화면에 경고 |
| 승인 전 내용 변경·중복 승인 | B의 hash/revision·잠금/CAS·멱등성 기반, D/E에서 도메인 스냅샷을 시험 |
| 확인을 agent가 스스로 승인 | 웹 본인 세션+PIN만, agent에 실행권/승인 토큰 반환 없음 |
| 토큰 조회를 위해 RLS 우회 | B가 공개 id 단일행 전용 최소 권한 경계를 시험. 슈퍼유저·기존 authDb의 포괄 조회 재사용 금지 |
| 비활성 생성 계약 | 기존 생성 경로와 같은 서비스 안에서 보장해야 함. C 착수 시 create/duplicate/import의 실제 active 동작을 확인 |
| SDK 신규 의존성 | B 승인 전 추가 금지. 라이선스·배포일·지원 프로토콜/문서는 그 시점에 확인 |
| MCP 클라이언트 OAuth 차이 | 수동 Bearer 지원 클라이언트만 1차 범위. 범용 OAuth 제공은 후속 별도 결정 |
| 네트워크 주소·인증서 | B/F에서 실제 사내/Tailscale 운영 주소를 확정. 인터넷 공개·터널 신규 개방은 승인 범위 아님 |
| 만료/요청 한도 수치 | ADR의 7/30일·15분·60/10/300회는 초기 제안값. G 시험 후 사용자 검토. 성능 실측으로 인용 금지 |
| 동적 라우트 지도 누락 | 현재 세 경로를 실코드 근거로 아래 분리. 본 A는 코드·도구 수정 금지라 feature-map 생성기 수정은 하지 않음. D/G에서 라우트 정합성을 재검증 |
| 사용자 승인 | ADR proposed 유지. B~G 설계/구현 착수는 허용, 운영 공개는 사용자 승인 후 |

## 5. API 대조표 읽는 법

아래 표는 기준 `origin/dev` 커밋 `35e1340d597c668f17965d7dbda863c64545b47d`의 생성 지도 전체를 대조한 목록이다. 각 줄은 정확히 하나의 method/path다. `confirm`은 HTTP API 직접 호출 허용이 아니라 사람 웹 실행을 위한 제안만 허용한다. 조건부 필드·초안 제한은 ADR과 2장 보정을 함께 적용한다. 이 표에 없는 라우트는 허용하지 않는다.

<!-- ROUTE_MATRIX -->

대조 결과는 총 126건이다. read 28건, write 15건, confirm 10건, exclude 73건이다. 지도에 없는 API를 이 표에 포함한 건수는 0건이다.

| 기능 | 기존 API | 분류 | scope |
|---|---|---|---|
| account | `GET /account` | exclude | `없음` |
| account | `GET /account/invitations` | read | `invitations.read` |
| account | `POST /account/invitations` | confirm | `invitations.propose` |
| account | `DELETE /account/invitations/{id}` | confirm | `invitations.propose` |
| account | `POST /account/members` | exclude | `없음` |
| account | `POST /account/members/{userId}/enrollment` | exclude | `없음` |
| account | `POST /account/members/{userId}/passkey-reset` | exclude | `없음` |
| account | `POST /account/members/{userId}/pin/reset` | exclude | `없음` |
| account | `POST /accounts` | exclude | `없음` |
| account | `POST /accounts/active` | exclude | `없음` |
| account | `POST /dev/login` | exclude | `없음` |
| account | `GET /dev/test-accounts` | exclude | `없음` |
| account | `GET /invitations/{token}` | exclude | `없음` |
| account | `POST /invitations/accept` | exclude | `없음` |
| account | `GET /me` | exclude | `없음` |
| account | `PATCH /me` | exclude | `없음` |
| account | `GET /me/images/{kind}` | exclude | `없음` |
| account | `PUT /me/images/{kind}` | exclude | `없음` |
| account | `POST /me/images/{kind}/upload-url` | exclude | `없음` |
| account | `GET /me/login-history` | exclude | `없음` |
| account | `GET /me/passkeys` | exclude | `없음` |
| account | `DELETE /me/passkeys/{id}` | exclude | `없음` |
| account | `PATCH /me/passkeys/{id}` | exclude | `없음` |
| account | `PUT /me/pin` | exclude | `없음` |
| account | `POST /me/pin/verify` | exclude | `없음` |
| account | `GET /me/sessions` | exclude | `없음` |
| account | `DELETE /me/sessions/{id}` | exclude | `없음` |
| approval | `GET /approval-admin/overdue` | exclude | `없음` |
| approval | `POST /approval-admin/transfer` | confirm | `org.sensitive.propose` |
| approval | `GET /approval-line-templates` | read | `forms.read` |
| approval | `POST /approval-line-templates` | write | `forms.write` |
| approval | `DELETE /approval-line-templates/{id}` | write | `forms.write` |
| approval | `POST /approvals` | write | `documents.draft.write` |
| approval | `GET /approvals/{id}` | read | `documents.read` |
| approval | `GET /approvals/{id}/attachments` | read | `documents.read` |
| approval | `POST /approvals/{id}/attachments` | exclude | `없음` |
| approval | `DELETE /approvals/{id}/attachments/{attachmentId}` | exclude | `없음` |
| approval | `GET /approvals/{id}/attachments/{attachmentId}/url` | exclude | `없음` |
| approval | `POST /approvals/{id}/attachments/upload-url` | exclude | `없음` |
| approval | `GET /approvals/{id}/body` | read | `documents.read` |
| approval | `POST /approvals/{id}/circulate` | exclude | `없음` |
| approval | `GET /approvals/{id}/comments` | read | `documents.read` |
| approval | `POST /approvals/{id}/comments` | write | `documents.comment.write` |
| approval | `PUT /approvals/{id}/draft` | write | `documents.draft.write` |
| approval | `PUT /approvals/{id}/draft-line` | write | `documents.draft.write` |
| approval | `GET /approvals/{id}/form` | read | `documents.read` |
| approval | `PUT /approvals/{id}/line` | exclude | `없음` |
| approval | `GET /approvals/{id}/print-preview` | read | `documents.read` |
| approval | `GET /approvals/{id}/recipients` | read | `documents.read` |
| approval | `PUT /approvals/{id}/recipients` | write | `documents.draft.write` |
| approval | `POST /approvals/{id}/redraft` | exclude | `없음` |
| approval | `POST /approvals/{id}/steps/{stepId}/act` | exclude | `없음` |
| approval | `GET /delegations` | read | `org.read` |
| approval | `POST /delegations` | confirm | `org.sensitive.propose` |
| approval | `DELETE /delegations/{id}` | confirm | `org.sensitive.propose` |
| approval | `GET /forms` | read | `forms.read` |
| approval | `POST /forms` | write | `forms.write` |
| approval | `GET /forms/{id}` | read | `forms.read` |
| approval | `GET /forms/{id}/draft` | read | `forms.read` |
| approval | `PUT /forms/{id}/draft` | write | `forms.write` |
| approval | `POST /forms/{id}/duplicate` | write | `forms.write` |
| approval | `GET /forms/{id}/export` | read | `forms.read` |
| approval | `PUT /forms/{id}/favorite` | exclude | `없음` |
| approval | `POST /forms/{id}/versions` | confirm | `forms.publish.propose` |
| approval | `POST /forms/import` | write | `forms.write` |
| approval | `GET /inbox/mine` | read | `documents.read` |
| approval | `GET /inbox/pending` | read | `documents.read` |
| approval | `GET /mailbox/{box}` | read | `documents.read` |
| approval | `POST /recipients/{recipientId}/distribute` | exclude | `없음` |
| approval | `POST /recipients/{recipientId}/receive` | exclude | `없음` |
| approval | `GET /search` | read | `documents.read` |
| approval | `GET /search/export` | exclude | `없음` |
| audit | `POST /approvals/{id}/print-log` | exclude | `없음` |
| audit | `GET /approvals/{id}/timeline` | read | `documents.read` |
| audit | `GET /audit-logs` | exclude | `없음` |
| audit | `GET /audit-logs/reviews` | exclude | `없음` |
| audit | `POST /audit-logs/reviews` | exclude | `없음` |
| backup | `GET /account/exports` | exclude | `없음` |
| backup | `POST /account/exports` | exclude | `없음` |
| backup | `GET /account/exports/{id}/download` | exclude | `없음` |
| backup | `GET /system/backups` | exclude | `없음` |
| backup | `POST /system/backups` | exclude | `없음` |
| backup | `POST /system/backups/{id}/delete` | exclude | `없음` |
| backup | `GET /system/backups/{id}/download` | exclude | `없음` |
| backup | `GET /system/me` | exclude | `없음` |
| completion | `GET /approvals/{id}/package` | exclude | `없음` |
| completion | `GET /approvals/{id}/package/pdf` | exclude | `없음` |
| completion | `GET /approvals/{id}/package/zip` | exclude | `없음` |
| notification | `GET /me/push/config` | exclude | `없음` |
| notification | `POST /me/push/subscribe` | exclude | `없음` |
| notification | `POST /me/push/unsubscribe` | exclude | `없음` |
| notification | `GET /me/telegram` | exclude | `없음` |
| notification | `POST /me/telegram/link` | exclude | `없음` |
| notification | `POST /me/telegram/unlink` | exclude | `없음` |
| notification | `GET /notifications` | exclude | `없음` |
| notification | `POST /notifications/{id}/read` | exclude | `없음` |
| notification | `POST /notifications/read-all` | exclude | `없음` |
| notification | `GET /notifications/unread-count` | exclude | `없음` |
| notification | `GET /system/telegram` | exclude | `없음` |
| notification | `POST /system/telegram/mode` | exclude | `없음` |
| notification | `POST /telegram/webhook` | exclude | `없음` |
| org | `GET /account/approval-policy` | read | `org.read` |
| org | `GET /account/capabilities` | read | `org.read` |
| org | `GET /account/members` | read | `org.read` |
| org | `PATCH /account/members/{userId}` | confirm | `org.sensitive.propose` |
| org | `GET /account/members/{userId}/assignment-history` | read | `org.history.read` |
| org | `PUT /account/members/{userId}/assignments` | write | `org.write` |
| org | `GET /account/members/{userId}/identity-history` | read | `org.history.read` |
| org | `POST /account/members/{userId}/roles` | confirm | `org.sensitive.propose` |
| org | `DELETE /account/members/{userId}/roles/{grantId}` | confirm | `org.sensitive.propose` |
| org | `GET /account/settings` | read | `org.read` |
| org | `PATCH /account/settings` | exclude | `없음` |
| org | `GET /businesses` | read | `org.read` |
| org | `POST /businesses` | exclude | `없음` |
| org | `PATCH /businesses/{id}` | exclude | `없음` |
| org | `GET /businesses/{id}/seal` | exclude | `없음` |
| org | `PUT /businesses/{id}/seal` | exclude | `없음` |
| org | `POST /businesses/{id}/seal/upload-url` | exclude | `없음` |
| org | `GET /departments` | read | `org.read` |
| org | `POST /departments` | write | `org.write` |
| org | `DELETE /departments/{id}` | confirm | `org.sensitive.propose` |
| org | `PATCH /departments/{id}` | write | `org.write` |
| org | `POST /departments/{id}/move` | write | `org.write` |
| org | `GET /departments/export` | exclude | `없음` |
| org | `POST /departments/import` | exclude | `없음` |
| org | `GET /org-chart` | read | `org.read` |

### 생성 지도 밖 동적 경로의 실코드 근거

이 세 경로는 위 지도 대조 건수에 넣지 않는다. `features/approval/src/api/documents-routes.ts:265-293`의 배열·템플릿 라우트 등록으로 존재를 확인했다. 지도에 없다는 이유로 존재하지 않는다고 삭제하거나, 지도에 있다고 주장하지 않는다.

| 실코드 API | 분류 | scope | 근거 |
|---|---|---|---|
| `POST /approvals/{id}/submit` | confirm | `documents.submit.propose` | 배열 원소 submit + 템플릿 경로 |
| `POST /approvals/{id}/withdraw` | exclude | `없음` | 배열 원소 withdraw + 템플릿 경로 |
| `POST /approvals/{id}/reopen` | exclude | `없음` | 배열 원소 reopen + 템플릿 경로 |

Better Auth의 `/api/auth/*` 플러그인 경로는 이 기능 지도에 전부 열거되지 않는다. 등록/로그인/세션/플러그인 관리 등은 모두 MCP 제외다. health 같은 앱 합성 경로도 업무 도구로 등록하지 않는다. B가 새로 만드는 토큰 관리·승인 큐·`/mcp`는 기존 API 대조 건수와 분리하고 새 기능 지도로 검증한다.

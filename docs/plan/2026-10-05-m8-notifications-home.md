---
title: M8 알림·홈·통합 검증
date: 2026-10-05
status: draft
tags: [notification, dashboard, e2e, infra]
related: [NTF-001, NTF-002, NTF-006, DSH-001, ADR 0007, mvp-roadmap]
---

## 목표
결재 요청이 내 차례가 되면 인앱 배지와 텔레그램 봇 DM으로 알리고, 홈에서 결재 대기·진행 중·최근 완료 문서를 한눈에 본다. 시나리오 S2~S7을 E2E로 묶고 스테이징 배포 구성을 마련한다.

## 범위
- 포함: NTF-001(이번 단계는 아래 이벤트 목록), NTF-002(인앱 + 텔레그램 DM. 이메일은 문서로만 남김), NTF-006(알림 링크는 로그인·재인증 거침), DSH-001(공지 제외 — 아래 Q3), M6·M7이 넘긴 알림(월간 점검 누락, 덤프 실패·누락), E2E S2~S7, 스테이징 compose 초안.
- 제외: 웹 푸시(NTF-003), 알림톡·웹훅(NTF-004), 사용자별 채널 설정·방해 금지(NTF-005, P1), 관리자 대시보드(DSH-002, P1), 게시판(DSH-003), 소셜 로그인(M9).

## 설계 초안
- **소비자:** `approval_event` outbox(ADR 0007)를 worker가 읽어 `notification` 행을 만든다. 처리 위치를 `approval_event.processed_at`이 아니라 소비자별 커서(`notification_cursor`)로 두어 PDF·웹훅 소비자와 겹치지 않게 한다. 중복 방지는 `(event_id, recipient_membership_id, kind)` 유니크.
- **수신자 매핑(이벤트 → 받는 사람):**

| 이벤트 | 받는 사람 |
|---|---|
| `step_activated` | 단계 결재자(대결자 있으면 대결자도) |
| `rejected`·`completed`·`withdrawn` | 기안자(`completed`는 참조·수신·공람 대상 포함은 M5 수신 규칙 재사용) |
| `post_pending` | 후결자 |
| `delegate_unavailable` | 기안자 + 원 결재자 |
| `line_changed` | 추가된 결재자·기안자 |
| 월간 점검 누락(`review-status`) | `audit.read` 보유자, 매월 1회 |
| 덤프 실패·누락(`backupHealth`) | 시스템 관리자 |

- **저장:** `notification(id, account_id, recipient_membership_id, kind, document_id?, title, body, read_at, telegram_status, created_at)`. RLS는 `account_id`, 읽기·읽음 처리는 본인 구성원만.
- **인앱:** 헤더 벨 배지(`GET /api/notifications/unread-count`, 30초 폴링 → 실시간은 후속), 알림 센터 목록·모두 읽음.
- **텔레그램:** 봇은 사용자가 먼저 `/start`를 눌러야 DM할 수 있다(채널이 아니라 1:1 대화). 내 정보 화면의 "텔레그램 연결"이 일회용 토큰이 든 `t.me/<봇>?start=<토큰>` 링크를 만들고, **수신 어댑터**(`TelegramReceiver` 인터페이스: 폴링·웹훅 두 구현)가 `/start <토큰>`을 받아 `telegram_link(membership_id, chat_id)`에 저장한다. 토큰은 해시 저장·10분 만료·1회용. 발송은 pg-boss 큐 `notify-telegram`, 전송 코드는 `fetch`로 Bot API `sendMessage`만 쓴다(새 패키지 없음). 429는 `retry_after`를 따르고 403(차단)이면 연결을 해제한다. 실패는 3회 재시도 후 `telegram_status=FAILED`. **메시지에는 문서 내용·제목을 넣지 않고** "결재 요청 1건 · 기안자 이름"과 `/approval/{id}` 링크만 담는다(외부 서비스로 고객 데이터가 나가지 않게). 링크를 열면 로그인·재인증을 거친다(NTF-006). 봇 토큰은 `.env`의 `TELEGRAM_BOT_TOKEN`으로만 둔다. 발송부는 어댑터 인터페이스로 분리해 이메일·카카오는 문서로만 남긴다.
- **홈(DSH-001):** `GET /api/home` 한 번에 결재 대기 수·목록 5건, 내가 올린 진행 중, 최근 완료 5건, 자주 쓰는 양식(M4 즐겨찾기). 기존 카드 3개는 하단 바로가기로 내린다.
- **통합 검증:** S2~S7 E2E, 스테이징 compose(`docker-compose.staging.yml`) 초안과 Cloudflare Access 절차 문서. 실제 터널·Access 적용은 이 PC에서 검증할 수 없으므로 "미검증"으로 표시한다.

- **수신 방식 전환:** 시스템 관리자가 시스템 설정 화면에서 `폴링 | 웹훅`을 고른다(`system_setting.telegram_mode`, 기본 폴링). worker는 설정을 주기적으로(30초) 읽어 어댑터를 바꾼다: 폴링 → `getUpdates` 롱폴링 루프(마지막 `update_id`를 DB에 저장), 웹훅 → 시작 시 `setWebhook(url, secret_token)` 등록 후 `POST /api/telegram/webhook`이 `X-Telegram-Bot-Api-Secret-Token`을 상수 시간 비교로 검증해 같은 처리 함수로 넘긴다. 웹훅으로 바꿀 때는 폴링을 먼저 멈추고 `setWebhook`, 되돌릴 때는 `deleteWebhook` 후 폴링을 시작한다(둘이 동시에 돌면 409). 웹훅 전환은 공개 HTTPS 주소(`PUBLIC_BASE_URL`)가 있을 때만 허용하고, `getWebhookInfo`로 등록 상태·마지막 오류를 화면에 보인다. 웹훅 비밀 값은 `.env`(`TELEGRAM_WEBHOOK_SECRET`). 연결 처리(토큰 해시 조회·chat_id 저장)는 수신 방식과 무관한 한 함수로 둔다.

## 단계
- [x] 1. 계획 확정(Q1~Q4 답변)
- [x] 2. 스키마·마이그레이션(0018·0019): `notification`, `event_notified`, `telegram_link`, `telegram_link_token`, `system_setting`, 이벤트 조회 함수 `notification_pending_events`, RLS·권한
- [x] 3. core 순수 함수: 이벤트 → 수신자·문구 매핑 (단위 테스트)
- [x] 4. worker 소비자 + 텔레그램 수신 어댑터(폴링·웹훅)·연결 처리·발송 큐 (통합 테스트: 중복 방지, 대결, 재시도, 토큰 만료·재사용, 차단 시 해제; Bot API는 가짜 서버)
- [x] 5. API·벨·알림 센터 화면, 내 정보 "텔레그램 연결", 시스템 설정의 수신 방식 전환
- [x] 6. 월간 점검·덤프 알림 스케줄
- [x] 7. 홈 대시보드
- [x] 8. E2E S2~S7, 스테이징 compose·문서
- [ ] 9. `web-design-guidelines` 점검, 보안 리뷰, INDEX 갱신

## 완료 기준
lint·typecheck·단위·통합(연속 2회)·E2E·`next build` 통과. 실제 봇으로 연결 → 상신 → DM 수신 → 링크로 결재까지 확인(봇 토큰은 사용자가 발급해 줘야 하며, 없으면 가짜 서버까지만 검증하고 "실봇 미검증"으로 보고).

## 결정이 필요한 질문
| # | 질문 | 제안 |
|---|---|---|
| Q1 | 알림 발송 수단 | **결정(2026-10-05):** 인앱 + 텔레그램 봇 DM. 이메일·카카오 알림톡은 문서(NTF-004)로만 남기고 구현하지 않는다. 발송부는 어댑터로 분리 |
| Q2 | 실시간 | 폴링(30초)으로 시작, SSE는 후속 |
| Q3 | "공지" 위젯 | 게시판(DSH-003, P2)이 없어 제외, 홈에서 뺀다 |
| Q4 | 기한 임박·초과 알림 | 기한 필드가 아직 없으면 제외 |

## 결정·변경 기록
- 2026-10-05: 초안 작성
- 2026-10-05: 사용자 결정 — 이메일·카카오는 문서로만, 알림은 인앱 + 텔레그램 DM. 수신은 어댑터(폴링/웹훅)로 만들고 시스템 관리자가 서버 설정에서 전환
- 2026-10-05: 2단계 완료. 이벤트 소비 커서는 늦게 커밋된 이벤트를 놓칠 수 있어 `event_notified`(처리 표시) + 교차 계정 DB 함수로 바꿨다(`notification_cursor` 폐기). 텔레그램 연결·토큰은 사용자 단위라 RLS 없이 `fmerp_auth`만 접근, `system_setting`(수신 방식·`getUpdates` 오프셋)은 앱 역할이 읽고 쓰되 삭제 불가. 통합 테스트 9건(격리·권한·중복·함수 실행 권한) 통과. 백업 실패 알림은 수신자가 계정 소속이 아닌 시스템 관리자라 6단계에서 별도 설계
- 2026-10-05: 3단계 완료. `packages/core/src/notification-rules.ts`의 `notificationsForEvent(event, ctx)` — 인앱 문구(`title`·`body`)와 외부 채널 문구(`external`)를 분리하고, 외부 문구에는 문서 제목·의견·사유를 넣지 않는다(단위 테스트로 고정). 반려 의견은 인앱 본문에도 싣지 않는다. 종류에 `approval_held`·`document_received`를 추가해 core와 db 목록을 맞췄다(db는 core에 의존하지 않아 두 목록을 함께 고쳐야 한다). `submitted`·`released`·`post_approved`는 알림이 없다
- 2026-10-05: 4단계 완료. 새 패키지 `packages/notification`(`telegram-api` fetch 클라이언트, `link` 토큰·`/start` 처리, `receiver` 폴링·웹훅 어댑터와 `ReceiverManager`, `consume` 이벤트→알림, `send` 발송, `test-support` 가짜 Bot API). worker `notification-jobs.ts`가 5초마다 이벤트를 소비하고(`notify.telegram` 큐, 재시도 3회, 마지막 실패만 FAILED) 30초마다 설정을 읽어 수신 방식을 맞춘다. 마이그레이션 0020(`notification.external_text`, 발송 누락 보정 함수). 봇 토큰이 없으면 인앱만 만들고 `telegram_status=NONE`. 웹훅 요청을 받는 `POST /api/telegram/webhook`과 시스템 설정 화면은 5단계. 통합 테스트: notification 20·worker 2 추가, 전체 통합 403 통과(1회), 단위 323. **알려진 한계:** ① 실제 텔레그램·실봇 미검증(가짜 서버만) ② 부서 대상 수신(담당자 미지정)은 개인 알림 대상이 아님 ③ 계속 실패하는 이벤트는 7일 동안 5초마다 재시도·로그(오류 로그 폭주 가능) ④ 웹훅 전환 실패 시 폴링으로 자동 복귀하지 않음(상태에 오류 표시, 관리자가 설정을 되돌려야 함)
- 2026-10-06: 5단계 완료. API(`routes/notifications.ts`): 알림 목록·미확인 수·읽음·모두 읽음(본인 것만, 남의 알림 404), `/me/telegram`(상태·연결 링크·해제), `/system/telegram`(상태 조회, 방식 변경은 시스템 관리자+PIN 재인증+감사 로그, 웹훅 조건 미충족 시 409), `POST /api/telegram/webhook`(비밀 헤더 상수 시간 비교, 틀리면 404, 처리 오류도 200). 화면: 헤더 벨(30초 폴링 배지)·알림 센터 `/notifications`·내 정보 "알림" 탭(연결 링크 열기 → 3초마다 연결 확인 → 해제)·`/system/telegram`. 웹은 `TELEGRAM_BOT_TOKEN`·`TELEGRAM_BOT_USERNAME`·`TELEGRAM_WEBHOOK_SECRET`을 읽고 공개 주소는 `BETTER_AUTH_URL`(worker는 `PUBLIC_BASE_URL`, 같은 값으로 둔다). 통합 테스트 10건 추가(전체 413, 연속 3회 통과), E2E 6건 추가(전체 연속 확인은 m8 6건만 재실행), `next build` 통과, 개발 서버 화면 확인(알림 목록·모두 읽음·배지·내 정보 탭·시스템 설정). **간헐 실패 1회:** 전체 통합 2회째에 "다른 회사 알림" 시험이 실패했다. 원인은 로그로 확정하지 못했고(다른 시험이 사용자를 다른 회사에 합류시켜 구성원·활성 회사가 어긋난 것으로 추정), 시험이 회사를 slug로 고정하고 활성 회사를 맞추도록 고친 뒤 연속 4회 통과했다. **미검증:** ① 봇 토큰이 설정된 화면(연결 버튼·연결 대기·해제 흐름)은 개발 서버에서 직접 보지 못했고 API 통합 테스트만으로 확인 ② 웹훅 전환 성공 경로(공개 https 환경) ③ `web-design-guidelines` 점검은 9단계에서
- 2026-10-06: 6단계 완료. `packages/notification/src/alerts.ts`: ① 월간 점검 누락 — 회사마다 지난달 점검 기록이 없으면 **계정 범위** `audit.read` 보유자(소유자·계정 관리자·계정 범위 감사인)에게 달마다 한 번(`audit-review:<달>`), 부서·사업자 범위 감사인은 대상이 아니다 ② 덤프 문제 — 시스템 관리자(`SYSTEM_ADMIN_EMAILS`, 인증된 이메일)에게 최근 24시간 안의 실패한 덤프(`backup-failed:<id>`)와 03:30 기한 누락(`backup-overdue:<날짜>`)을 한 번씩. 받는 사람이 회사 소속이 아니므로 재직 중인 모든 회사에 인앱 알림을 만들고 텔레그램은 사용자당 첫 회사의 알림 한 건만 보낸다. worker가 30분마다 판정(`notification-jobs.ts`), 알림 이동 경로는 core `notificationPath`(문서 → `/approval/<id>`, 점검 → `/admin/audit`, 덤프 → `/system/backups`)를 목록 API의 `href`와 텔레그램 링크가 함께 쓴다. worker도 `SYSTEM_ADMIN_EMAILS`를 읽는다(웹과 같은 값). 통합 5건·단위 1건 추가. **한계:** 점검 누락은 달마다 한 번만 알리고 재알림(독촉)은 없다. 덤프 누락 판정은 설치 직후 이력이 없으면 곧바로 "누락"으로 알린다(실제로 누락이므로 의도). 덤프 알림은 개발 환경에서 worker를 띄워 직접 확인하지 않았다.
- 2026-10-06: 7단계 완료. 홈(`app/(app)/page.tsx`)을 대시보드로 바꿨다: 요약(결재 대기·진행 중·임시저장 건수), 결재 대기 5건, 내가 올린 진행 중 5건, 최근 완료 5건, 자주 쓰는 양식 바로가기(즐겨찾기 먼저, 다음 최근 사용 순, 최대 6개), 내 정보·조직도·관리 콘솔 링크. 새 API 없이 기존 `/inbox/pending`·`/inbox/mine`·`/forms`를 재사용했다(계획의 `GET /api/home`은 만들지 않음 — 목록 3개를 한 번에 줄 이득보다 중복 코드가 컸다). 양식 바로가기는 `/approval/new?form=<id>`로 들어가 그 양식을 미리 고른다. 결재 대기는 오래 기다린 순이라 5건을 넘으면 오래된 것부터 보이고, 나머지는 "모두 보기"에서 본다. E2E: 홈 시나리오 1건(기안·상신 → 결재자 홈 → 승인 → 기안자 최근 완료)과 360px 홈 넘침 확인을 추가했고, 처음 전체 실행에서 실패한 시험 2건을 고쳤다(M6 감사 로그 360px 시험의 `조회` 버튼 이름이 감사 로그 행의 "감사 로그 조회"와 겹치던 것 `exact` 지정, 내 시험이 다른 시험이 남긴 결재 대기 때문에 5건 밖으로 밀리던 것). 전체 E2E 52 통과(3 건너뜀), 단위 324, 린트·타입·`next build` 통과. **한계:** 공지 위젯 제외(Q3), 홈 데이터는 목록 API 3개를 각각 불러 한 번에 갱신되지 않는다(화면이 목록마다 "불러오는 중"을 따로 보인다).
- 2026-10-06: 8단계 완료. **수용 시나리오 S2~S7 검증 위치(PRD 9장)**

| 시나리오 | 확인하는 곳 | 비고 |
|---|---|---|
| S2 부서 뎁스 제한 | E2E `m2.spec.ts` "사업자 등록 검증, 부서 생성·뎁스 제한·이동", 단위 `department-tree.test.ts` | 최대 뎁스 낮추기 거부·이동 시 뎁스 초과 거부 포함 |
| S3 기안→합의→결재→감사→완료 | 통합 `approval.int.test.ts`(병렬 합의·감사·완료·채번·완료 후 수정 거부), E2E `m4.spec.ts`(단일 결재 + 모바일 PIN 재인증) | 6단계 전체 체인을 브라우저로 처음부터 끝까지 도는 E2E는 없다. 완료 PDF는 worker가 있어야 생겨 통합 테스트(`package-jobs.int.test.ts`)가 확인 |
| S4 반려와 재기안 | E2E `m4.spec.ts` "반려하면 기안자가 재기안 초안을 만들 수 있다 (S4)" | 반려 알림은 통합 `notification.int.test.ts` |
| S5 대결 | E2E `m8.spec.ts` "부재 중인 결재자의 문서를 대결자가 승인하면 결재란에 대결로 표시된다", 통합 `approval.int.test.ts` | **이번에 결재란 "대결 OOO" 표시를 추가했다**(전에는 문서 이력 타임라인에만 있었다). "팀장의 후열함"은 확인하지 않았다 |
| S6 감사인 열람·무결성 | E2E `m6.spec.ts`, 통합(`audit_log` UPDATE·DELETE 거부 `m1.int.test.ts`) | 사업자 B 문서 검색 제외는 통합에서. 무결성 검증 버튼은 P1이라 없음 |
| S7 보관·덤프·이관 | 통합 `package-jobs.int.test.ts`·`backup-jobs.int.test.ts`·`export.int.test.ts`, 복구 리허설(M7 기록) | 8일째 정리·버킷 복사 후 복원은 수명 주기 규칙이 필요해 **로컬에서 검증 불가**. 덤프 실패 30분 안 알림은 6단계(30분 판정)와 통합 테스트 |

스테이징: `docker-compose.staging.yml`, `apps/web/Dockerfile`, `.env.staging.example`, [ops/staging.md](../ops/staging.md). web 이미지를 이 PC에서 빌드해 개발 DB에 붙여 실행했고(health 정상, 스테이징 모드 테스트 로그인 동작, `APP_ENV` 없이 켜면 막힘) compose 문법도 검사했지만, **worker 이미지·migrate/seed 서비스·Cloudflare Tunnel·Access 정책은 검증하지 못했다.** 결정: 스테이징은 운영과 같은 이미지(`NODE_ENV=production`)로 돌고 테스트 로그인이 필요해서, 운영 모드의 테스트 로그인 금지에 `APP_ENV=staging` 예외를 추가했다(`resolveDevTestLogin`, 단위 테스트 추가). Access가 뒤에서 막는다는 가정에 의존하므로 9단계 보안 리뷰에서 다시 본다.

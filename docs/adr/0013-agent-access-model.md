---
status: proposed
---

# 개인 에이전트 토큰과 명시적 MCP 도구로 사용자 권한을 제한한다

외부 AI 클라이언트는 사용자의 업무를 돕지만 사용자의 웹 세션이나 PIN을 받지 않는다. 사용자·계정·멤버십에 고정된 개인 에이전트 토큰으로 허용 도구만 호출한다. 이 ADR은 제안 상태다. 카드 B~G는 이를 구현 기준으로 착수하되, 사용자 승인과 G 검증 전 운영 노출은 하지 않는다.

## 1. 인증과 토큰 수명

### Better Auth 검토와 선택

`better-auth-best-practices`에 따라 `pnpm-lock.yaml`의 설치 버전 **1.7.7**을 확인했다. [공식 버전 색인](https://better-auth.com/llms.txt)은 1.7 문서를 [현재 문서](https://better-auth.com/docs/llms.txt)에 연결한다. [API Key 플러그인](https://better-auth.com/docs/plugins/api-key)은 별도 `@better-auth/api-key` 패키지이며 발급·검증·만료·속도 제한과 사용자/조직 소유 키를 제공한다. 플러그인이 없거나 1.7에서 불가능하다는 판단은 아니다.

다만 **그대로는 이 접근 모델을 충족하지 못한다.** 한 키를 사용자와 테넌트 멤버십에 동시에 고정하는 복합 FK·RLS, 즉시 휴직/퇴사 차단, 기존 `can()`과 업무 객체 열람 판정, 원자적 감사 기록은 4mERP가 추가로 소유해야 한다. 조직 소유 키는 개인 대행 모델과도 다르다. [세션 변환 옵션](https://better-auth.com/docs/plugins/api-key/advanced)은 PIN이 필요한 웹 경로와 경계를 흐릴 수 있다. 신규 패키지 승인과 플러그인 관리 HTTP 경로 차단도 필요하다.

이 때문에 B의 기본안은 **자체 `agent_token` 표**다. 플러그인으로 동일한 불변조건을 입증하는 대안은 ADR 변경으로 제안할 수 있으나, 두 토큰 체계를 함께 만들지 않는다. 이번 문서 작업에서는 패키지나 인증 코드를 추가하지 않는다. B 구현 전 1.7.7 타입·문서와 신규 SDK 문서를 다시 확인한다. 이 세션에는 Context7 도구가 없어 공식 문서를 직접 조회했으며, 플러그인을 설치·실행한 검증은 하지 않았다.

### 저장 계약

- `agent_token`의 소유 기능은 `account`다. 스키마에 `@owner account`, 새 마이그레이션 첫 줄에 `-- feature: account`를 둔다.
- 필드는 `id`, `account_id`, `membership_id`, `user_id`, `name`, `secret_hash`, `scopes`, `created_at`, `expires_at`, `revoked_at`다. `(membership_id, account_id, user_id)`의 유일 키·복합 FK로 소속과 사용자가 함께 일치하게 한다. 계정·사용자·scope는 발급 후 불변이다. 변경 대신 폐기 후 재발급한다.
- 비밀 부분은 CSPRNG 32바이트 이상이다. 공개 식별자와 비밀 부분을 분리하고 SHA-256 해시만 저장한다. 비교는 고정 시간 비교다. 고엔트로피 토큰이므로 사람이 고른 PIN의 Argon2id 규칙과 구별한다.
- 평문은 발급 응답·화면에서 한 번만 표시한다. 목록·감사·오류·프록시 로그·추적·분석 도구에 남기지 않는다. 응답은 `Cache-Control: no-store`, 재조회·복구 기능은 없다. 토큰 목록은 공개 id와 표시명·scope·수명·폐기 상태만 반환한다.
- `/me`의 사람 세션에서 현재 계정의 본인 키만 발급·폐기한다. 발급은 명시적 확인과 엄격한 PIN 재인증을 요구한다. 재인증은 웹 전용이다. MCP는 키 발급·scope 확대·계정 전환·다른 키 생성 도구를 갖지 않는다. 본인 폐기는 재인증 없이 즉시 가능하게 한다.
- 제안 기본 만료는 7일, 최대 30일이다. 영구 키·자동 갱신은 없다. 발급 scope는 명시적으로 선택하고 기본 선택은 없다. 관리자라도 전체 권한 scope를 묵시 부여하지 않는다.
- 토큰에서 계정을 정한다. 헤더·인자·웹 세션의 active account로 덮어쓰지 않는다. 요청마다 DB에서 만료·폐기·멤버십 `active`·현재 역할을 재검사한다. 양의 인증 캐시와 세션 전환은 쓰지 않는다. 휴직·퇴사·탈퇴·계정 삭제는 즉시 차단한다.
- 즉시 폐기는 폐기 트랜잭션 커밋 뒤 시작된 요청을 거부한다는 뜻이다. 이미 완료된 행위는 취소되지 않는다. 쓰기는 최종 트랜잭션에서 토큰 행 잠금·재검사를 하고 폐기와 직렬화한다. DB 장애 시 허용하지 않는다.
- 인증 전 토큰 조회는 공개 id로 한 행만 읽는 전용 최소 권한 경계에서 한다. 일반 테넌트 우회 연결을 재사용하지 않는다. 조회 결과는 인증 목적 외 반환하지 않으며, 인증 후 모든 테넌트 데이터는 `withTenant(appDb, accountId, ...)`와 RLS로 처리한다. B는 이 최소 권한 경계와 FK·RLS를 실제 DB 시험으로 입증해야 한다.

## 2. 권한과 도구 경계

허용 조건은 `유효한 개인 토큰 ∧ 도구 allowlist ∧ 정확한 scope ∧ can(actor, action, target) ∧ 기존 업무 객체 규칙`이다. scope는 RBAC 역할이 아니라 **추가 상한**이다. 토큰 소유자의 현재 역할·사업자/부서 범위를 요청마다 읽고, 구성원 대상은 `authorizeForMember`, 문서는 기존 열람·초안 소유권 검사를 그대로 통과한다. `document.read_all`이 없는 관리자는 관리 권한만으로 본문을 읽을 수 없다.

`can()`에 없는 본인 초안 행위에 가상의 Action을 만들거나 `approval.act`만으로 대체하지 않는다. 기존 서비스의 본인·문서 상태·양식 규칙 판정을 보존하고, 조직 읽기 등 대응 Action이 있는 경우 `can()`을 함께 적용한다. 목록도 접근 가능한 대상만 반환한다. 타 계정 객체는 404, 같은 계정에서 scope/권한 부족은 403, 무효 토큰은 같은 401로 처리한다.

scope 이름은 다음으로 고정한다. 와일드카드·`admin`·`all`은 없다.

| scope | 허용 상한 |
|---|---|
| `forms.read` | 양식·초안·양식 정의 JSON export, 결재선 템플릿 조회 |
| `forms.write` | 비활성 양식 생성/복제/import, 작성자별 초안 저장, 본인 템플릿 생성/삭제 |
| `forms.publish.propose` | 양식 버전 게시 제안만 |
| `documents.read` | 허용 문서·본문·댓글·타임라인·첨부 메타데이터·인쇄 미리보기 |
| `documents.draft.write` | 본인 초안 생성/편집·초안 결재선·초안 수신처 |
| `documents.comment.write` | 기존 공개 범위 판정을 통과한 의견 추가 |
| `documents.submit.propose` | 본인 문서 상신 제안만 |
| `org.read` | 조직·구성원·설정·capabilities의 허용 정보 |
| `org.history.read` | 소속/이름·메일 변경 이력, 기존 관리 권한 추가 필요 |
| `org.write` | 부서 생성/수정/이동, 허용 범위 소속 변경 |
| `org.sensitive.propose` | 구성원 상태·역할·부서 삭제·위임·일괄 이관 제안만 |
| `invitations.read` | 권한 범위의 초대 메타데이터 |
| `invitations.propose` | 초대 생성/폐기 제안만 |

각 도구는 이름·입력/출력 스키마·scope·위험등급(`read/write/confirm`)·허용 상태·권한 함수를 하나의 레지스트리에 선언한다. 도구 목록과 호출 권한은 같은 선언에서 나온다. `tools/list`에서 숨겨도 `tools/call`에서 다시 검사한다. 임의 URL·SQL·HTTP method/path를 받는 범용 도구는 금지한다. 새로운 API는 자동 노출되지 않는다. HTTP API 표와 MCP 도구는 1:1일 필요가 없으며, 계획의 경로 표는 기존 업무 근거이지 API 프록시 명세가 아니다.

본문·댓글·양식 설명은 신뢰하지 않는 데이터로 구조화해 반환한다. 그 안의 명령을 시스템 지시나 승인으로 취급하지 않는다. 외부 URL을 fetch하거나 서명 URL을 되돌려주는 기능은 없다. 목록은 페이지 크기 최대 100, 단일 응답은 1MiB 상한을 두고 초과는 명시적 오류/페이지 안내로 처리한다. 문서 HTML을 클라이언트가 실행하지 않게 데이터로 표시하며 미리보기의 도장·서명 URL은 제거한다.

## 3. PIN 금지와 사람 확인

**에이전트는 PIN을 입력·전달·보관하지 않고, PIN 재인증이 필요한 행위를 실행하지 않는다.** 결재 처리와 진행 중 결재선 변경은 제안 도구조차 만들지 않는다. 웹 세션 쿠키나 PIN 검증 시각을 MCP 문맥에 주입하지 않는다.

`confirm`은 실행권이 아니라 **승인 대기 제안(pending action)** 생성권이다. 사람이 승인 토큰을 에이전트에 주는 설계는 채택하지 않는다.

1. 에이전트는 검증된 입력으로 제안을 만든다. 서버가 계정·소유자·token id·도구명·정규화 입력 해시·대상 revision/content hash·만료·멱등 키를 저장한다. 초대·문서 본문 같은 민감 payload는 DB에 원문을 넣지 않고 비공개 S3 키와 해시만 둔다.
2. 기본 만료는 15분이다. 상태는 `pending → executed/rejected/expired/stale`다. 승인 자체로 별도의 재사용 가능한 실행권을 발급하지 않는다. 같은 제안 생성 멱등 키의 다른 입력은 409다.
3. 웹 승인 대기 큐는 **제안한 토큰의 소유자 본인만** 접근한다. 다른 관리자가 대신 승인해 토큰에 없던 권한을 보태지 않는다. 대상·차이·외부 공개 영향·문서 본문/결재선/수신처를 서버에서 다시 읽어 표시한다. 제안 내용은 HTML 정화 후 데이터로 렌더링한다.
4. 사람 세션·CSRF·현재 역할·scope·토큰 유효성·대상 revision을 재검사하고 PIN으로 엄격하게 재인증한 뒤 **웹 요청 안에서 기존 업무 서비스**를 실행한다. 상신은 본문/결재선/수신처까지 묶인 해시가 달라지면 stale로 만들고 새 제안을 요구한다. 편집 후 기존 승인은 재사용하지 않는다.
5. 실행은 제안 행 잠금·상태 CAS·업무 멱등 키로 중복 클릭/재시도를 한 번으로 수렴시킨다. DB 변경·실행 결과·감사는 같은 트랜잭션이다. S3/외부 부수효과는 기존 불변 쓰기·outbox 규칙을 적용한다. 실패 후 불명확한 실행을 자동 반복하지 않는다.
6. 에이전트는 pending id와 상태만 받는다. 승인/거절/execute 도구와 bearer 승인 토큰은 없다. 웹에서 생긴 초대 링크도 사람 화면에만 1회 표시하고 MCP에는 주지 않는다.

`agent_pending_action`도 `@owner account`, account RLS·복합 FK가 필요하다. B가 상태·웹 큐·재인증·멱등 실행 기반을 만들고 C~E는 도메인별 실행 함수를 합성 루트에 등록한다. 확인 UI/재검사/원자 실행이 준비되지 않은 confirm 도구는 등록하지 않는다.

## 4. 감사

현재 `audit_log`에는 `detail`이나 `actor_kind`가 없고 `diff`가 있다(`packages/db/src/schema/audit.ts`). B에서 **nullable `actor_kind`, `agent_token_id`, `agent_pending_action_id`**를 추가하는 새 마이그레이션을 제안한다. 과거 행을 UPDATE하여 채우지 않는다. 감사 스키마 소유권은 기존 `shared`를 유지하고 기능 지도 읽기/쓰기 선언도 갱신한다.

에이전트 요청은 `actorUserId=토큰 소유자`, `actor_kind=agent`, 공개 token id·request id·도구명·대상 id·결과를 기록한다. 웹 확정 실행은 `actor_kind=human`과 승인자 id, 원 제안/token id로 연결한다. 감사 API에 원문 payload·PIN·Authorization·토큰 해시·서명 URL을 기록하지 않는다. 업무 변경과 성공 감사는 같은 트랜잭션이며 감사 실패 시 변경도 실패한다. 거부·인증 실패는 별도 최소 필드 감사로 남기되 공격자가 보낸 임의 token id를 신뢰하지 않는다.

기존 민감 열람 감사·마스킹·열람 중복 억제는 보존한다. 문서 GET이 읽음 기록을 만들 수 있다는 점도 숨기지 않는다. 상태 변경·확인·거부뿐 아니라 MCP의 허용 읽기도 token id로 추적 가능하게 한다. audit_log 권한은 INSERT/SELECT만 유지하고 UPDATE/DELETE·과거 행 보정 코드는 만들지 않는다.

## 5. 전송과 앱 경계 비교

| 후보 | 이점 | 비용/판단 |
|---|---|---|
| 기존 웹 Hono에 `/mcp` 추가 | 배포 단위가 적고 기존 세션 인프라를 가까이 재사용 | 쿠키·PIN 경로 혼입과 일반 `/api` 토큰 수용 위험. 기본안에서 제외 |
| 독립 `apps/mcp` 합성 루트에서 Hono와 기능 서비스 재사용 | 별도 포트·네트워크·자격 증명 경계, 세션 없는 토큰 전용 입구 | 이미지·health·종료 처리 추가. **기본안** |
| 독립 앱이 기존 REST를 임의 프록시 | 초기 접착 코드가 적음 | 세션 흉내·SSRF·PIN 우회 위험. 제외 |
| 로컬 stdio 서버 | HTTP 인증 구성이 단순 | 클라이언트별 배포·로컬 비밀·OS 실행 차이. 기본 제공하지 않음 |

`apps/mcp`는 앱끼리 import하지 않는다. 기능의 공개 service/agent 진입점을 조합하고, 필요하다면 기존 API의 업무 함수를 해당 기능 service로 옮긴다. `features/a → features/b` import는 금지한다. 인증/제안 소유는 account, 업무 변경은 원래 기능, 감사 공통 구현은 shared다. 앱이 표를 직접 바꾸지 않는다. 새 파일 배정·exports·feature map·구조 검사를 B에서 함께 처리한다.

[Streamable HTTP 명세](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)를 기준으로 `/mcp`의 POST와 필요 시 SSE를 지원한다. JSON-RPC/MCP 오류는 프로토콜 형식으로, HTTP 인증·전송 오류는 ADR 0003 RFC 9457로 구별한다. 인증 오류를 HTTP 200 도구 성공으로 포장하지 않는다. B는 SDK 버전·지원 프로토콜·initialize 협상을 계약 시험으로 고정한다.

사내/Tailscale의 TLS 엔드포인트만 공개한다. 인터넷 공개와 OAuth 자동 발견은 이번 범위가 아니다. 수동 `Authorization: Bearer`를 설정할 수 있는 MCP 클라이언트만 지원하며 OAuth 전용 클라이언트 호환은 주장하지 않는다. TLS 종단 후 내부 HTTP는 신뢰된 사설 네트워크로 제한한다. MCP 토큰은 웹 `/api`에서 수용하지 않는다.

모든 요청(초기화·목록·SSE 포함)을 인증한다. Origin이 있으면 설정 allowlist와 정확히 대조하고 그 외는 403, 없으면 비브라우저 Bearer 검증을 계속한다. Host도 설정 allowlist로 검증하여 DNS rebinding을 막는다. CORS는 기본 비허용이다. 세션 id는 인증 수단이 아니며 발급 시 token/account에 묶고 다른 키의 재사용을 거부한다. SSE 재연결도 만료/폐기를 검사하고 장기 연결을 주기적으로 재검증·종료한다.

초기 운영 제한 제안은 token별 60회/분, 그중 write/confirm 10회/분, 계정별 300회/분, 미인증 실제 IP별 20회/분, token별 동시 실행 2개다. JSON-RPC batch는 비활성화한다. 요청 본문 1MiB·도구 실행 30초·SSE 최대 5분을 상한으로 둔다. 중앙 DB의 원자적 카운터 또는 동일 수준 공유 저장소로 다중 프로세스에서도 합산하고, 저장소 장애는 fail closed다. 초과는 429와 `Retry-After`를 준다. IP는 배포별 `trustedIpHeaders()` 정책만 사용한다. 이 수치는 처리량 실측값이 아니라 보수적 초기 정책이며 G 부하 시험에서 조정한다.

## 6. 영향과 구현 기준

허용·확인·제외의 정확한 method/path와 API 지도 누락은 [구현 계획](../plan/2026-11-13-agent-access.md)에 둔다. 새 토큰·승인 큐·MCP 경로는 아직 존재하지 않는 **구현 예정 계약**이다. 기존 웹 API에 이 ADR의 보호가 이미 적용됐다고 해석하지 않는다. 배포 전 새 마이그레이션·폐기 시험·scope/권한 교집합 시험·제외 도구 전수 검증이 필요하다.

참조 근거는 ADR 0005·0006·0008·0010, `docs/rules/security.md`, `docs/rules/api.md`, `shared/src/domain/permissions.ts`, `features/account/src/service/auth.ts`다. 이 문서가 PRD의 PIN·RLS·감사·완료 패키지 불변조건을 완화하지 않는다.

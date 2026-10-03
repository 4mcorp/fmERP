# 보안·개인정보 규칙

기준: [PRD 5.1 인증 · 5.5 감사 · 6.3 보안 · 6.4 법규](../PRD.md)
스킬: **`better-auth-best-practices`**, **`better-auth-security-best-practices`**, **`organization-best-practices`**, **`differential-review`**(보안 관점 변경 리뷰), **`semgrep`**
관련: [ADR 0005](../adr/0005-better-auth-organization-as-tenant.md) · [ts: Better Auth 연동](../ts/2026-10-03-better-auth-integration.md) · [M1 보안 리뷰](../plan/2026-10-03-m1-security-review.md)

## 1. 인증
- 로그인은 Better Auth의 Google·Naver 공급자를 쓴다(M9). 사용자 식별은 **공급자의 고유 ID**로 하고, 이메일로 식별하거나 자동 병합하지 않는다 (PRD AUTH-002·004).
- **개발용 테스트 로그인**(M1~M8): 시드 계정만, `DEV_TEST_LOGIN=true`이고 운영이 아닐 때만 켜진다. 운영 모드에서 켜려 하면 서버가 기동되지 않아야 한다 (`resolveDevTestLogin`). 테스트 계정·비밀번호는 `packages/auth/src/test-accounts.ts`에만 둔다.
- 결재 PIN은 Argon2id(`@node-rs/argon2`)로 해시하고, 5회 실패하면 15분 잠근다 (PRD AUTH-009).
- 세션 쿠키는 HttpOnly·Secure·SameSite를 쓴다. 비활성화된 구성원의 세션은 즉시 끊는다 (PRD AUTH-008·015).
- Better Auth가 여는 HTTP 경로 중 감사 로그·업무 규칙을 우회하는 것은 `disabledPaths`로 막고, 같은 기능은 감사 로그를 남기는 자체 API로 제공한다.

## 1-1. API 요청 처리 (apps/web/server/http.ts)
- 미들웨어 순서: 요청 정보 → 본문 크기 제한(1MB) → 동일 출처 검사 → 세션(유휴·절대 만료) → 테넌트(재직 구성원 확인) → 역할 → 핸들러.
- 감사 로그의 접속 IP는 `trustedIpHeaders()`만 믿는다. 운영은 `CF-Connecting-IP`만 쓰고, 클라이언트가 위조할 수 있는 `X-Forwarded-For`는 개발·테스트에서만 쓴다.
- 오류는 `AuthDomainError`·`ApiError`를 던지고, 응답은 `onError`가 RFC 9457 형식으로 만든다. 내부 오류 내용은 응답에 넣지 않는다.

## 2. 비밀정보
- 비밀정보는 환경 변수로만 주입한다. 저장소에는 `.env.example`(값 없음)만 둔다.
- 로그, 에러 메시지, 감사 로그의 diff, 외부 도구 질의(Context7 등)에 토큰·키·PIN·개인정보를 넣지 않는다.

## 3. 개인정보
- 주민등록번호는 MVP에서 수집하지 않는다.
- 휴대폰 번호 같은 민감 필드는 애플리케이션 계층에서 암호화한다 (PRD NFR-S03).
- 운영자도 고객 문서 본문을 열람하는 경로를 만들지 않는다 (PRD NFR-S09).
- 감사 로그 필수 기록 대상·항목·보존 기간은 PRD AUD-020~026을 따른다.

## 4. 입력·출력
- 리치 텍스트 HTML은 서버에서 정화(sanitize)한 뒤 저장한다.
- 업로드 파일은 확장자가 아니라 MIME과 실제 내용으로 검증하고, SHA-256을 기록한다 (PRD FILE-002).
- 로그인, PIN 입력, API 호출에는 속도 제한을 둔다 (PRD NFR-S06).

## 5. 리뷰
인증, 권한, 감사 로그, 파일 처리 코드를 바꾼 뒤에는 `differential-review` 스킬로 보안 관점 리뷰를 한다.

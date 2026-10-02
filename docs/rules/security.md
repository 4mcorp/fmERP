# 보안·개인정보 규칙

기준: [PRD 5.1 인증 · 5.5 감사 · 6.3 보안 · 6.4 법규](../PRD.md)
스킬: **`better-auth-best-practices`**, **`better-auth-security-best-practices`**, **`differential-review`**(보안 관점 변경 리뷰), **`semgrep`**

## 1. 인증
- 로그인은 Better Auth의 Google·Naver 공급자를 쓴다. 사용자 식별은 **공급자의 고유 ID**로 하고, 이메일로 식별하거나 자동 병합하지 않는다 (PRD AUTH-002·004).
- 결재 PIN은 Argon2id(`@node-rs/argon2`)로 해시하고, 5회 실패하면 15분 잠근다 (PRD AUTH-009).
- 세션 쿠키는 HttpOnly·Secure·SameSite를 쓴다. 비활성화된 구성원의 세션은 즉시 끊는다 (PRD AUTH-008·015).

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

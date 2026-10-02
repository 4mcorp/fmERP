---
status: accepted
---

# API 에러 응답은 RFC 9457 Problem Details

모든 API 오류는 `Content-Type: application/problem+json`으로 `{ type, title, status, code, detail? }`를 반환한다. `code`는 프런트엔드가 분기하는 업무 오류 코드(예: `db_unavailable`, `pin_locked`)이고, `type`은 `urn:fmerp:problem:<code>`이다. 내부 예외 메시지·스택은 응답에 넣지 않고 서버 로그에만 남긴다. 구현: `apps/web/server/problem.ts`.

**Considered Options:** 자체 형식 `{ error: { message } }`(표준이 아니라 OpenAPI·클라이언트 공유가 어려움).

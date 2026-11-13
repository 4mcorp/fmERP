---
title: 개인 에이전트 토큰 B1 구현과 검증
date: 2026-11-14
status: in-progress
tags: [agent, auth, security, db, test]
related: [docs/adr/0013-agent-access-model.md, docs/plan/2026-11-13-agent-access.md]
---

# B1 토큰 경계

## 범위

`agent_token`과 감사 연결 필드, 사람 세션의 발급·목록·폐기 API, `/me?tab=agents`를 구현한다. MCP 서버·도구·승인 대기 실행은 후속 카드 범위다. ADR 0013은 proposed를 유지하며 운영 공개 승인을 뜻하지 않는다.

## 선택한 구조

별도 BYPASSRLS 로그인 역할과 운영 비밀을 추가하는 안 대신 `lookup_agent_token(uuid)` SECURITY DEFINER 함수를 쓴다. 소유자는 마이그레이션 역할이며 `search_path=pg_catalog, pg_temp`로 고정한다. 공개 id가 일치하는 유효 토큰 한 행의 account_id와 secret_hash만 반환한다. PUBLIC과 fmerp_auth의 EXECUTE를 회수하고 fmerp_app만 호출한다. 함수 밖의 테이블 SELECT에는 RLS가 계속 적용된다.

비밀은 32바이트 CSPRNG, 저장은 SHA-256, 비교는 timingSafeEqual이다. 비밀 일치 뒤에만 `withTenant`로 들어가 토큰을 잠그고 수명·폐기·현재 멤버십과 역할을 다시 확인한다. `membership_id, account_id, user_id` 복합 FK가 소유 관계를 고정한다. fmerp_app의 UPDATE는 revoked_at·last_used_at만 허용하며 트리거가 소유자·해시·scope·수명 변경과 폐기 되돌리기를 추가 차단한다.

감사의 새 열은 nullable이고 기존 행은 수정하지 않는다. 감사는 대상이 삭제되어도 보존해야 하므로 기존 audit_log 원칙대로 token/pending id에도 FK를 붙이지 않는다. pending 표 자체는 이번 카드에서 만들지 않는다.

## B2 공개 계약

`@fmerp/feature-account/agent`는 `authenticateAgentToken`, `withAgentToken`, `authorizeAgent`, `AgentIdentity`만 공개한다. 발급 함수는 이 진입점에 노출하지 않는다.

- 인증 함수는 사용자·계정·멤버십·scope·현재 actor를 반환한다. 캐시하거나 웹 세션으로 바꾸지 않는다.
- 업무 쓰기는 반드시 `withAgentToken(appDb, token, async (tx, identity) => ...)` 콜백의 **동일 tx**에서 scope/현재 권한·객체 소유권 판정, 업무 변경, 성공 감사를 마친다. 새 트랜잭션이나 콜백 밖의 쓰기는 폐기와 직렬화되지 않는다.
- `authorizeAgent(identity, scope, { action, target })`는 scope와 기존 `can()`의 교집합을 검사한다. 본인 초안처럼 Action이 없는 동작은 scope 후 원래 서비스의 소유권/상태 검사를 유지한다.
- 잘못된 토큰은 동일한 401, 유효 토큰의 scope/권한 부족은 403, 타 계정 객체는 업무 서비스에서 404다. 카드의 '다른 계정 404'를 무토큰 404로 확대하지 않는다.
- 폐기는 토큰 행 잠금으로 진행 중 콜백과 직렬화한다. 폐기 커밋 뒤 시작한 인증은 실패한다. 휴직/역할 회수는 요청의 멤버십·권한 조회 시점에 반영한다. 이미 권한 검사를 마친 요청을 중간에 취소하는 계약은 아니다.
- last_used_at은 성공한 콜백의 커밋 시 갱신된다. 실패한 업무까지 성공 사용 이력으로 기록하지 않는다.
- PIN·Authorization·비밀·해시·원문 payload를 감사·MCP 로그에 넣지 않는다. 에이전트 입력으로 request context를 그대로 신뢰하지 않는다.

## 검증

입력 계약 시험은 구현 전 모듈 부재로 실패했고 구현 후 2건 통과했다. 최초 격리 통합 시험은 10건 통과했다. 함수 ACL·불변성·감사 롤백을 추가한 전체 시험과 1280/360px UI·원격 CI는 최종 카드/PR 증거에서 확인한다. 초기 통과를 최종 head의 검증으로 대신하지 않는다.

테스트 러너 기본 CPU limits 합계 5가 상시 파드 4.5와 합쳐 quota 8을 넘었다. 미실행 Job만 삭제한 뒤 ignored artifacts의 템플릿 복사본에서 runner CPU만 3에서 1.5로 낮췄다. 메모리·실행 제한·검증 기대값·저장소 배포 템플릿은 바꾸지 않았다.

## 적대적 자가검토

1flow 1agent 규칙에 따라 같은 worker가 보안 경계와 diff를 검토한다. 운영자의 별도 중간 관찰은 최종 검증을 대체하지 않는다.

- 발급 관리 함수까지 B2에 노출되던 package entry를 인증 전용 공개 진입점으로 좁혔다.
- SQL 삽입 오류에 바인딩한 해시가 실릴 수 있어 발급 예외는 비밀 없는 일반 오류로 바꿨다.
- UI 비밀은 React 메모리에만 두고 Query cache·storage에 넣지 않는다. 계정 전환 시 컴포넌트를 재생성하고 숨김/이탈 시 복구하지 않는다.
- E2E 비밀 발급 시나리오는 trace를 끄고 screenshot에서 토큰 입력을 마스킹한다.
- 새 테이블에 권한을 명시하고 fmerp_auth의 기본 권한을 회수했다. 기존 감사 INSERT 권한만 유지하며 UPDATE/DELETE 코드를 추가하지 않았다.

---
status: accepted
---

# Better Auth organization 플러그인을 테넌트("계정")로 쓰고, 인증 전용 DB 역할을 둔다

PRD의 "계정"(회사 단위 테넌트)과 "구성원"은 Better Auth organization 플러그인의 organization·member로 구현한다. 테이블 이름은 PRD 데이터 모델에 맞춘다.
- organization → `account`, member → `membership`, 세션의 activeOrganizationId → `active_account_id`
- Better Auth 기본 `account`(로그인 수단) 테이블은 `user_identity`로, 그 안의 공급자 고유 ID 필드는 `provider_account_id`로 바꾼다. 테넌트 FK `account_id`와 혼동하지 않기 위해서다.

Better Auth는 테넌트를 지정하기 전에 구성원·세션을 조회해야 하므로, 전용 DB 역할 `fmerp_auth`(BYPASSRLS)로 연결한다. 이 역할은 인증·테넌트 테이블과 감사 로그 기록(INSERT)·본인 이력 조회에만 권한을 가진다. 업무 데이터는 RLS가 적용되는 `fmerp_app`으로만 접근한다.

초대는 Better Auth 초대 기능을 쓰지 않고 자체 `invitation` 테이블(토큰 해시, 1회용, 7일 만료, 프리셋)로 구현한다. Better Auth 초대는 초대 이메일과 로그인 이메일이 같아야 수락되어, PRD의 링크 초대(AUTH-006)를 충족하지 못한다. Better Auth 초대 API 경로는 비활성화한다.

**Considered Options:** 테넌트·구성원·초대를 전부 자체 구현(활성 계정 전환·구성원 API를 다시 만들어야 함), Better Auth 연결도 `fmerp_app` + RLS(인증 시점에는 테넌트를 알 수 없어 정책이 복잡해짐).

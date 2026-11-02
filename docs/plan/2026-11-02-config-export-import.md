---
title: 구성 설정 JSON 내보내기·임포트 계획
date: 2026-11-02
status: accepted
tags: [config, org, approval, import, export, security]
related: [ORG-001, ORG-014, ORG-032, PERM-001, PERM-002, PERM-005, APV-004, APV-005, APV-006, AUD-020, AUD-022, docs/plan/2026-10-30-form-block-editor.md]
---

# 구성 설정 JSON 내보내기·임포트

이 문서는 확정된 구현 계획이다. 제안 CLI·API·권한·DB 경계는 **아직 없다**. 2026-11-02 사용자 답변 Q1~Q5를 반영했고 열린 질문은 0건이다. Q5는 A로 확정해 다른 key의 기존 구성원 연결을 지원하지 않고 충돌 시 전체 임포트를 차단한다.

## 1. 목표와 확정 범위

- 쉬운 초기 구성과 다운로드·업로드 파일을 통한 구성 백업·복원이 목적이다. 별도 구성 repo나 앱 내 장기 JSON 파일 보관 기능은 만들지 않는다. 공개 앱 repo에는 포맷과 허구 예제만 두고 실데이터를 넣지 않는다.
- 조직 구조, 구성원, 양식, 양식별 기본 결재선, 사용자 정의 역할·권한, 회사 설정을 JSON으로 내보내고 가져온다. 관리자 화면과 공통 로직의 `pnpm` CLI를 모두 제공한다.
- 안정 key로 생성·갱신한다. JSON에 없는 항목은 삭제·비활성화하지 않는다. 실제 대상 회사와의 diff 미리보기는 필수다.
- 구성원의 업무 정보는 이름·이메일·사번·부서·직위·역할로 제한한다. 안정 key는 매칭용 메타데이터다. PIN·패스키·세션·등록 토큰·초대 링크·비밀번호·공급자 계정·인증 검증 상태는 입출력 모두 금지한다.
- 사번은 자동 발급·불변이다. **최초 INSERT도 파일 사번을 지정하지 않는다.** 신규 구성원은 시스템이 채번한다. 이메일 일치만으로 사람을 병합하지 않는다.
- 사용자 정의 역할·권한 생성까지 포함한다. 고정 역할 배정만 제공하는 축소안은 채택하지 않는다. 저장 모델·`can()` 이행·권한 승격 방지가 선행 작업이다.
- 회사 공통 문서번호 기본 규칙을 추가하고 양식별 예외를 허용한다. 회사 전체 통합 순번은 도입하지 않는다. **문서함은 JSON 대상에서 제외**하며 생성·표시명·순서·노출 설정도 개발하지 않는다.
- 달라진 양식은 새 `form_version`을 만든다. 기존 문서의 `formVersionId`·스냅샷·본문·검색 색인·완료 패키지 `final/`은 유지한다.
- 관리자 권한·`account_id`·RLS 경계를 유지하고, 내보내기·임포트는 `audit_log` INSERT로 기록한다.

문서·첨부·완료 패키지·감사/발령 이력·실제 순번·양식 편집 초안·개인 즐겨찾기·알림·부재/대결은 대상이 아니다. 이 기능은 구성의 비파괴 병합 복원이며 DB 전체 복원이나 기존 계정 전체 ZIP을 대체하지 않는다. 파일에 없는 데이터가 남으므로 특정 시점의 완전한 상태 복제를 보장하지 않는다. 인증 재등록은 별도 절차다.

## 2. 현재 구현과 조사 근거

최초 서비스·DB 조사 기준은 `4469be35bf16dbb35ff71484fd40f49886b634eb`이다. 최종 검토 기준은 `origin/dev`의 `021d9975230b045013b53132abfe148ab24d862a`이며 블록 편집기 5~7단계(편집·작성/조회 통합·PDF 하네스)가 병합됐다. 구성 임포트에 필요한 초안 기준·정리·잠금 계약은 별도 선행 작업이다. 경로는 repo 루트 기준이다. `pnpm feature:find "구성 설정 조직 양식 권한"`으로 org·approval·account를 찾았다. 별도 settings 기능은 없고 회사 설정은 org가 제공한다.

| 대상 | 근거 | 현행 제약 |
|---|---|---|
| 사업자·부서·직위·직책 | `packages/db/src/schema/org.ts` | 사업자 code는 계정 안, 부서 code는 사업자 안에서만 고유하다. 직위·직책에는 안정 code가 없다 |
| 사번 | `packages/db/src/schema/tenant.ts`, `packages/db/migrations/0027_member_identity.sql` | 자동 발급·UPDATE 불변. 현행 트리거가 명시 INSERT 값을 보존하더라도 임포트 경로에서는 사용 금지다 |
| 이름·이메일 | `features/org/src/service/member-identity.ts`의 `changeIdentity` | user는 계정 공유 데이터다. 타 회사에도 속한 사용자는 변경 거부. 자체 authDb tx를 열어 전체 임포트 tx에 그대로 중첩할 수 없다 |
| 신규 구성원 | `features/account/src/service/enrollment.ts`의 `preRegisterMember` | 구성원 생성과 등록 토큰 발급이 분리돼 있다. 이메일 자동 병합은 금지한다 |
| 역할·권한 | `shared/src/domain/permissions.ts`, `org.ts`의 `roleGrant` | membership.role은 owner/admin/member, 부가 역할 4종과 `Action`·`RULES`는 코드 고정이다. 사용자 정의 저장 모델은 없다 |
| 양식 | `features/approval/src/service/forms.ts`의 `createForm`, `publishVersion`, `exportForm`, `importForm` | 기존 fmerp-form/1은 복제용이며 upsert가 아니다. scope·recipients와 내부 ID 참조를 별도로 변환해야 한다 |
| 편집 초안 | 같은 파일의 `getFormDraft`, `saveFormDraft`, `features/approval/src/ui/pages/admin-form-edit.tsx` | 작성자별 schema/layout·revision CAS와 편집기 자동 저장이 있다. 공개 양식과 편집 초안은 별개다 |
| 기본 결재선 | `features/approval/src/domain/approval-line.ts` | user/department/business_ceo는 내부 ID, duty는 이름, drafter_head는 동적이다 |
| 채번 | `shared/src/domain/doc-number.ts`, `forms.ts`의 `FormNumbering` | 규칙은 양식 버전, doc_number_series는 운영 상태다. 회사 공통 기본 규칙은 없다 |
| 문서함 | `features/approval/src/service/mailbox.ts`의 `MAILBOXES`, `boxCondition` | 코드 고정 조회이며 이번 범위에서 변경하지 않는다 |
| 회사 설정 | `features/org/src/api/org-routes.ts`의 `SettingsPatch` | 회사명·allowedDomains·maxDeptDepth·approvalLineMaxCells·securityPolicy. allowAdminExport 변경은 소유자 전용이다 |

기준 규칙은 [database.md](../rules/database.md), [architecture.md](../rules/architecture.md), [api.md](../rules/api.md), [security.md](../rules/security.md)다. PRD 3.2·3.3, 5.2·5.3, 5.4.2·5.4.7, 5.5.3을 참조한다. 복합 FK의 UNIQUE 생성 순서, Better Auth 우회 HTTP 경로 차단, 확인/쓰기 동시성 규칙을 적용한다. 공개 repo 여부와 현재 PR 상태는 구현 때도 다시 조회한다.

## 3. JSON v1 계약

### 3.1 외피와 누락 의미

- `format: "fmerp-config"`, `schemaVersion: 1` 필수. 미지 format·버전·속성과 중복 JSON 속성은 거부한다.
- 선택 섹션은 settings·businesses·departments·positions·duties·members·roles·permissions·forms다. 섹션 누락과 빈 배열은 기존 엔티티를 유지한다. 문서함 섹션은 허용하지 않는다.
- 항목은 key와 변경할 필드의 patch다. 필드 누락은 유지, nullable 필드의 명시적 null만 비우기다. 신규 항목에는 생성 필수 필드가 필요하다. 빈 문자열을 null로 바꾸지 않는다.
- 소속·역할 부여 배열은 추가·동일 key 갱신이며 빠진 부여는 유지한다. 단, 명시한 역할의 permission 집합과 권한의 action 집합은 해당 정의를 완전히 교체한다. 이것은 엔티티 삭제가 아니며 권한 축소도 diff에 표시한다. 미기재 역할·권한 엔티티는 유지한다.
- `forms[].version`은 완전한 불변 버전 정의다. schema.fields·layout.blocks·defaultLine·recipients는 버전 안에서 교체한다. version 누락은 현재 정의 유지다. 신규 양식에는 완전한 version이 필요하다.
- active·구성원 status·유효 종료일·삭제 지시어는 쓰기 계약에 없다. 활성 구성만 내보내고 제외 건수를 별도 보고한다. 비활성 항목 참조는 오류다.
- accountId·DB UUID·DB version 번호·createdAt·경로·SQL·실행 코드·S3 key는 입력 금지다. 대상 회사는 서버 세션에서 정한다. 출처 회사명·시각은 JSON 외 응답 메타데이터로 둔다. 아래 config key는 DB PK가 아니며 권한을 주지 않는다.
- UTF-8 JSON, HTTP/CLI 동일 1MiB 상한. 압축·원격 참조·include·환경변수 치환은 미지원이다. 항목·중첩·텍스트 상한은 도메인 계약 시험에서 고정한다.

### 3.2 안정 key와 참조

| 엔티티 | 파일 key | 매칭·변경 규칙 |
|---|---|---|
| 회사 설정 | 단일 settings | 세션의 선택 회사만. slug로 생성·접근 권한을 얻지 못한다 |
| 사업자 | code | `(account_id, code)`. 다른 code에 같은 사업자등록번호는 충돌 |
| 부서 | businessCode + code | 사업자까지 포함한 복합 key. 부모 참조도 같은 형태. 타 사업자 이동 금지 |
| 직위·직책 | key | `(account_id, config_key)` 신설. 기존 항목에는 일회성 key를 부여해 export한다. 이름 추측 매칭 금지 |
| 구성원 | key | membership에 별도 불변 config_key 신설, `(account_id, config_key)` UNIQUE. 기존 행은 서버가 일회성 키를 채운다. 이메일·사번·인증 user ID와 독립적이다 |
| 역할·권한 | key | account 범위 불변 key. builtin 예약 key와 사용자 정의 key 공간을 분리한다 |
| 역할 부여 | memberKey + roleKey + scope | scope는 account/business(code)/department(복합 key). 누락 부여 유지 |
| 소속 | memberKey + businessCode + departmentCode | 직위만 갱신하거나 겸직 추가. 기존 주소속 종료가 필요하면 자동 처리하지 않고 차단 |
| 양식 | code | 기존 `(account_id, form.code)`를 사용한다 |

code/config_key 변경은 이름 변경이 아니다. 새 key는 새 엔티티가 되므로 diff에 경고하며 기존 UI의 code 변경 경계도 맞춘다. 직위·직책·역할·권한 key는 영문 소문자로 시작하는 영문 소문자·숫자·`-`·`_` 1~64자다. 구성원 key는 서버 발급 불투명 키이며 새 수기 입력은 같은 검증 계약을 따른다. key 재사용·자동 대소문자 병합은 금지한다.

구성원 payload는 key·name·email·employeeNo·departments·roles만 받는다. employeeNo는 **내보낸 원본의 읽기 전용 참고값**이다. 기존 key가 맞으면 대상 사번을 유지하고, 신규 key면 원본 사번과 무관하게 시스템 채번한다. 소속은 businessCode·departmentCode·positionKey·isPrimary로 겸직별 직위를 보존한다. 개인 duty 배정은 허용 필드에 없으므로 기존 값을 유지하며, duty 결재 대상 미해결은 차단한다.

양식의 user 대상·user 필드 기본값·부서장(`headMemberKey`)·역할 부여는 모두 memberKey를 참조한다. **사번 참조를 쓰지 않는다.** 복원 시 `원본 key/원본 사번 → 대상 membership/새 사번` 재매핑 결과를 관리자에게 보여 주고 내부 참조는 대상 ID로 변환한다. 원본 사번은 감사 일반 로그나 새 membership 사번에 쓰지 않는다. 같은 회사에서는 key로 upsert, 빈 회사에서는 key를 유지해 생성하므로 재적용은 no-op이다. 같은 key에 상충 정체성이 오면 차단한다. 다른 회사의 기존 구성원이 파일과 다른 key를 가지면 연결하지 않는다. 이메일·사번만 일치해도 자동 병합하지 않으며 충돌은 전체 임포트를 차단한다. 관리자 명시 매핑·alias는 v1에서 제공하지 않는다(12장 Q5=A).

### 3.3 양식과 참조

forms의 meta는 name·category·scope, version은 현행 FormVersionInput의 schema·layout·defaultLine·numbering·retentionYears·securityDefault·recipients·allowLineEdit·policy 전체다. scope·recipients·기본값 깊숙한 UUID도 안정 참조로 왕복 변환한다.

- user는 memberKey, department는 businessCode+code, business_ceo는 businessCode와 선택 positionKey, duty는 dutyKey, drafter_head는 levels다. approval 소유 서비스가 내부 DraftLineItem으로 바꾼다.
- 필드 key·옵션 value·열 key·블록/결재 순서를 보존한다. 모르는 참조는 문자열로 통과시키지 않는다. HTML 정화와 schema/layout 검증을 재사용한다.
- meta만 바뀌어도 현재 정의를 복사해 새 버전 하나를 만든다. 동일 파일 재적용은 버전 증가 없이 no-op이다.

### 3.4 회사 기본 채번과 예시

`settings.documentNumberingDefault`에 회사 공통 rule·cycle·at를 저장한다. 양식에는 `numberingSource: "company" | "override"`와 override일 때만 명시 numbering을 둔다. 기존 양식은 모두 override로 이행해 현재 동작을 보존한다. 신규 양식은 company를 기본으로 한다. 회사 기본값이 없는데 company를 선택하면 오류다.

상속 선택은 편집 정책이고 발행 버전에는 **해결된 실제 numbering 값도 스냅샷**으로 고정한다. 회사 기본값 변경 시 company 양식의 현재 공개 버전과 비교해 영향 목록을 preview한다. 실제 규칙이 달라진 양식마다 새 버전을 만들며, 초안 충돌 검사는 파일에 직접 나오지 않은 영향 양식에도 적용한다. override 양식은 그대로 둔다. 기본값 저장만 하고 기존 공개 버전이 실시간으로 바뀌는 구현은 금지한다.

실제 순번은 현행 양식별 시리즈·주기 체계를 유지한다. doc_number_series와 employee_seq는 export/import하지 않고 리셋·복원하지 않는다. 기존 문서 번호·스냅샷·완료 패키지는 보존한다. 규칙 변경이 같은 표시 번호 충돌을 유발하면 차단하며 전사 통합 순번으로 바꾸지 않는다.

다음은 허구의 부분 갱신 예시다. DEMO 사업자는 대상 회사 또는 파일에 있어야 한다. 신규 양식 생성 예시가 아니다.

```json
{
  "format": "fmerp-config",
  "schemaVersion": 1,
  "settings": { "maxDeptDepth": 2 },
  "departments": [
    { "businessCode": "DEMO", "code": "FINANCE", "name": "재무팀", "parent": null }
  ],
  "forms": [
    { "code": "GENERAL", "name": "일반 기안", "category": "일반" }
  ]
}
```

## 4. 사용자 정의 역할·권한 선행 설계

고정 매트릭스 일치 검사만 하는 방안 대신 저장형 RBAC로 이행한다. org가 아래 테넌트 모델과 변경 서비스를 소유한다. 모든 새 표는 account_id·RLS·복합 FK·명시 GRANT·@owner를 갖춘다.

| 제안 모델 | 내용 |
|---|---|
| role_definition | account_id·config_key·name·builtin 여부·revision |
| permission_definition | account_id·config_key·name·허용 scope 종류·revision |
| permission_action | permission과 배포 코드의 Action 연결. 임의 실행식이나 와일드카드는 금지 |
| role_permission | 역할과 권한 정의의 다대다 연결 |
| role_assignment | membership·역할·scope 연결. 기존 role_grant를 이행 |

사용자는 권한 key·이름과 **기존에 구현된 Action 집합**을 정의하고, 역할에 묶어 부여할 수 있다. 새 업무 동작을 문자열 등록만으로 구현하지 않는다. permission_action의 대상은 서버의 닫힌 action catalog에 있어야 하며 미지 action은 거부한다. 새 기능 접근제어는 개발자가 action과 서버 검사 지점을 추가·검증한 뒤에만 정의에 쓸 수 있다. custom permission은 새 업무 코드가 아니라 기존 동작의 사용자 정의 묶음이다.

기존 owner/admin/member의 기본 의미는 보존한다. builtin 역할·권한은 예약·불변으로 두고 기존 부가 역할 4종을 동일 권한과 범위의 builtin 정의·배정으로 이행한다. 임포트는 builtin 정의를 수정하지 않고 일치 검증만 한다. 사용자 정의 역할·권한은 생성·갱신한다. 기존 부여 누락은 회수하지 않지만 명시한 정의의 permission/action 변경은 관련 사용자 모두에게 영향을 주므로 preview에 유효 권한 증감과 영향 인원을 표시한다.

`can(actor, action, target)`의 순수 경계는 유지한다. `loadActor`가 현재 tenant의 정의·배정에서 해결한 권한/범위를 로드하고 can은 그 데이터로 판정한다. `canInAnyScope`는 메뉴용이며 서버 대상별 검사를 대체하지 않는다. role 문자열 직접 비교·API 가드·capabilities·목록 필터·CLI도 전수 조사해 전환한다. 서버에 구/신 판정 두 경로를 남기지 않는다. 기존 매트릭스의 허용/거부와 scope 경계를 golden 시험으로 먼저 고정하고 이행 후 같은 결과인지 확인한다.

권한 승격 방지는 다음을 불변 조건으로 둔다.

- config.export/config.import와 역할·권한 정의 관리 action은 계정 owner/admin만 수행하며 사용자 정의 역할로 위임하지 않는다. owner 이전·덤프·PIN/패스키 초기화 등 보호 action은 custom permission에 넣지 않는다.
- 관리자의 기본 권한을 넘는 문서 전체 열람 등 소유자 전용·민감 action도 custom 권한으로 우회 부여하지 않는다. 현행 builtin 감사인 부여 정책과 재인증은 유지하며 이를 custom 묶음으로 복제하지 않는다.
- 부여자의 유효 권한과 scope를 넘는 정의/배정 변경은 거부한다. 정의 변경으로 간접 상승하는 모든 기존 배정까지 최종 후보 상태에서 검사한다. permission을 넓히거나 scope를 account로 올려 우회할 수 없다.
- 같은 임포트에서 실행자 자신의 유효 권한이 변하면 거부한다. owner 생성·강등·이전과 소유자 배정 변경도 금지한다. 파일이 새로 부여한 권한을 이 실행의 인가 근거로 쓰지 않는다.
- preview/apply마다 권한 revision을 재검사한다. 캐시는 정의·배정 변경 시 무효화해 다음 요청부터 반영한다. JSON에 빠진 부여를 삭제하지 않는다는 정책과 보안상 별도 회수 절차를 혼동하지 않는다.

## 5. 내보내기·검증·적용 순서

내보내기는 동일 DB 스냅샷에서 활성 구성과 최신 공개 양식만 읽고 내부 ID를 안정 key로 바꾼다. 엔티티 목록은 key 순, 객체 속성은 고정 순, 의미 있는 배열 순서는 유지한다. 같은 상태의 export는 같은 바이트다. 안정 key 미연결이나 무손실 표현 불가는 전체 실패이며 조용히 생략하지 않는다.

미리보기는 파일과 기존 DB를 합친 최종 후보 상태를 검증한다.

1. 관리자 인증·재인증·회사 선택, 크기·형식·버전·허용 속성을 검사한다. 인증 속성·DB UUID는 중첩 위치에서도 거부한다.
2. key 중복·정규화 충돌·사업자등록번호·이메일 충돌·구성원 매핑을 확인한다. 사번은 쓰기 값이 아니다. 타 회사 사용자 존재 여부를 노출하지 않는다.
3. 파일에 없는 기존 자식도 포함해 부서 부모·동일 사업자·순환·최종 뎁스를 검사한다. maxDeptDepth 증가는 먼저, 감소는 최종 트리가 맞을 때만 한다.
4. 사업자 → 직위·직책 → 부모 우선 부서(head 제외) → 역할·권한 정의 → 구성원 → 소속 → 부서장 → 역할 배정 → 회사 기본 채번/영향 양식 → 양식·결재선 순서로 계획한다. 파일 순서가 아니라 참조 그래프로 처리한다.
5. 공유 user 이름·메일 수정, 이메일 자동 연결, 충돌 주소속·비활성 참조를 거부한다. 소속 변경은 org 발령 이력과 진행 문서 보호 규칙을 따른다.
6. validateFormSchema·validateFormLayout·validateDocNumberRule·결재선 검증을 재사용한다. 30단계·회사 결재란 한도·동적 부서장·수신자·직책·scope의 해석 가능성을 확인한다.
7. 최종 유효 권한 증감·초안 경합·채번 영향까지 포함한 diff를 반환한다. 오류가 있으면 전체 apply 불가다. 일부 성공을 허용하지 않는다.

## 6. 미리보기 diff와 동시성

preview는 planId·payloadHash·baseHash·expiresAt·summary·items·warnings·errors·canApply를 반환한다. planId는 사용자·계정·권한 revision·파일·기준 상태에 묶인 서버 식별자다. 10분 만료를 제안한다. 해시는 권한 증명이 아니다.

items는 entity·stableKey·operation(create/update/unchanged/conflict)·changes·reasonCode다. changes는 JSON Pointer와 before/after다. 양식 newVersion·기준 공개 버전, 원본→대상 사번 재매핑, 권한 유효 증감, 회사 채번 변경의 간접 영향도 표시한다. 삭제/비활성 건수는 0이다. 권한 정의 내부 집합 교체는 엔티티 삭제와 구분한다.

| entity | stableKey | operation | 표시 내용 |
|---|---|---|---|
| department | DEMO + FINANCE | update | /name 전후 값 |
| form | GENERAL | update | 회사 기본 채번 영향, newVersion |
| member | member-demo | conflict | 기존 이메일 충돌, 자동 병합 불가 |

개인정보는 기본 마스킹하며 권한 있는 화면에서만 확인한다. CLI 기본 출력은 건수·필드명·오류 코드다. 전체 변경을 확인하지 않으면 apply를 열지 않는다. 보안 완화·권한 증감·초안 존재·새 버전·재매핑을 강조한다.

- 서버에 단기 preview payload를 RLS 표로 보관하고 만료 후 제거한다. 이것은 앱 내 JSON 보관함이 아니라 apply 검증용 임시 상태다. 클라이언트가 수정한 diff는 실행하지 않는다.
- apply는 planId·payloadHash·확인값·멱등 키를 받고 재인증·현 권한을 다시 검사한다. 영향 행·부재 key 생성 충돌·공개 버전·초안·권한 revision을 재검증한다.
- 일반 관리 UI도 같은 잠금/직렬화 규약에 참여한다. 임포트 전용 lock만으로 UI 경합을 해결했다고 보지 않는다. unique/직렬화 실패는 전체 롤백하고 다시 preview한다.
- 기준 변경은 `409 config_preview_stale`, 만료는 config_preview_expired, payload 불일치는 config_payload_mismatch다. 같은 plan 재전송은 같은 결과, 새 plan의 같은 파일은 no-op이다.
- no-op은 안정 참조 도메인 값으로 비교한다. 객체 순서·누락/default 차이는 정규화하되 필드·블록·결재선 순서는 보존한다. layout.blocks 없음과 명시적 열은 legacy 출력이 다를 수 있어 무조건 동일시하지 않는다.

## 7. 서비스 경계와 원자성

org가 모든 표를 직접 쓰는 후보는 approval/account 소유권을 침범한다. **features/config 조정 기능과 소유 기능 포트 주입**을 택한다. 제안 표면은 `previewConfig(actor, account, payload)`, `applyConfig(actor, account, planId, idempotencyKey)`, `exportConfig(actor, account)`다. API와 CLI는 동일 서버 서비스를 사용한다.

config domain은 JSON·안정 참조·순수 diff만 소유하고 DB·네트워크·프레임워크를 import하지 않는다. org는 조직·RBAC·회사 설정, approval은 양식/채번/참조 변환, account는 구성원 정체성 경계를 소유한다. `apps/web/server/app.ts` 합성 루트에서 주입하며 기능 간 직접 import하지 않는다. 새 API·exports·표 읽기·파일 배정·기능 지도를 등록한다.

업무 적용은 `withTenant(appDb, accountId, tx => ...)` 한 tx다. 현재 changeIdentity/preRegisterMember의 자체 authDb tx를 순서대로 호출하면서 원자적이라고 하지 않는다. 선행 단계에서 account 소유의 좁은 SECURITY DEFINER 경계를 제안한다. appDb tx에서 신규 user/membership 또는 이름·메일만 처리하고 관리자·현재 계정·대상 membership·타 계정 공유 보호·이메일 충돌을 DB 경계에서도 재검사한다. 고정 search_path·PUBLIC EXECUTE 회수·최소 입력·감사/이력 동시 INSERT를 요구한다. 생성 시 사번 인자는 받지 않고 트리거가 채번한다.

이 경계는 인증 자격을 읽거나 쓰지 않고 config에 user 전체 DML·BYPASSRLS를 주지 않는다. 타 회사 행을 노출하지 않고 최소 보호 판정만 한다. 보안·원자성·롤백 시험 전에는 구성원 쓰기를 활성화하지 않는다. 신규 구성원의 등록 링크 발급과 인증 재등록은 기존 관리 절차로 별도 수행한다.

## 8. 관리자 UI·CLI·감사

신규 config.export/config.import는 owner/admin 전용, custom 역할 위임 불가다. 기존 account 전체 ZIP 권한과 혼동하지 않는다. allowAdminExport 완화는 owner만 가능하고 ownership.transfer는 별도 화면만 허용한다. settings는 회사명·allowedDomains·maxDeptDepth·approvalLineMaxCells·허용 securityPolicy·documentNumberingDefault만 받는다. timezone/locale 고정값은 검증만 하고 서버 환경변수·SMTP·S3·DB 자격은 받지 않는다.

제안 API는 `/api/account/config/export`, `/api/account/config/preview`, `/api/account/config/apply`다. 내보내기 준비·URL 재발급·apply에 재인증을 요구한다. 파일은 packages/storage의 임시 키와 짧은 서명 URL로 다운로드한다. final/을 쓰지 않으며 만료 객체 정리를 둔다. 업로드는 상한 내 JSON 요청이다.

UI는 회사 설정의 구성 설정에서 대상·개인정보 경고 → export 재인증·다운로드 또는 upload → 회사명·diff → 권한/버전/재매핑 확인 → 재인증·apply 순서다. 1280px/360px·키보드 탐색·오류 포커스·stale/실패/no-op을 확인한다.

다음 명령은 **구현 예정 예시**다.

```text
pnpm config:export --account <선택회사> --out <파일.json>
pnpm config:preview --account <선택회사> --file <파일.json>
pnpm config:apply --account <선택회사> --plan <planId>
```

CLI는 DB 비밀번호·actor 이메일로 관리자 자칭하는 스크립트가 아니라 동일 인증 API 클라이언트다. 정상 브라우저 로그인/재인증으로 단기 세션을 연결하고 연결 코드·세션을 JSON·argv·콘솔·repo에 두지 않는다. 보호된 로컬 자격 경로만 사용한다. 대화형 apply는 회사명·요약을 확인한다. 장기 서비스 토큰·비대화형 자동 적용·force·skip-preview는 제공하지 않는다. repo 보관은 요구하지 않으며 로컬 다운로드 파일도 적용할 수 있다.

CLI 종료코드는 성공/no-op 0, 입력 2, 인증/권한 3, stale/충돌 4, 내부 실패 1이다. 출력 파일은 기본 0600, 덮어쓰기는 명시 확인한다. 키·사번 재매핑 상세는 개인정보로 취급해 화면/보호 파일로만 제공한다.

감사 action은 config.export/config.preview/config.apply와 RBAC 정의·배정 변경이다. export 준비와 URL 발급을 구분하며 클라이언트 수신 완료를 주장하지 않는다. account·실제 actor·UTC·요청 ID·신뢰 IP·채널·정제된 결과 코드·필드명/건수·대상 ID·planId를 INSERT한다. 원문 JSON·diff 값·이름·이메일·원본 사번·서명 URL·파일명·원문 파일 hash는 일반/감사 로그에 남기지 않는다. 이름·메일 전후 값은 전용 member_identity_history에만 둔다.

성공 aggregate/하위 감사는 같은 tx이며 실패하면 전체 롤백한다. 시작 attempt는 별도로 먼저 INSERT하고 업무 실패 뒤 정제된 실패 감사도 별도 tx에 INSERT한다. 실패 감사도 저장 못 하면 운영 경보를 낸다. 감사는 UPDATE/DELETE하지 않는다. preview 원문·다운로드 객체는 짧은 수명으로 정리하고 로컬 파일 보안·삭제를 안내한다. 별도 구성 repo나 장기 파일 보관함은 추가하지 않는다.

## 9. 블록 편집기와 충돌

공개 form_version만 내보내며 form_draft·브라우저 자동 저장 상태는 대상이 아니다. 편집·작성/조회·PDF 검증이 병합돼도 초안 기준 버전/정리·동시성 문제가 저절로 해결된다고 가정하지 않는다.

- 변경할 공개 양식에 작성자 초안이 하나라도 있으면 해당 임포트 전체를 차단한다. 회사 기본 채번이 간접 변경하는 양식도 같다. 초안을 덮거나 지워서 해결하지 않는다.
- 현재 공개 후 초안이 남고 baseVersionId가 없다. 기준 공개 버전 추적과 명시적 정리 계약이 선행돼야 한다. revision 0 재시작은 오래된 탭의 ABA를 만들 수 있어 tombstone 또는 단조 증가 revision으로 방지한다.
- publishVersion·초안 생성/갱신·임포트가 동일 form 잠금과 버전 유일성 규약을 쓴다. latest+1이나 preview 직후 초안 존재 검사만으로 해결됐다고 하지 않는다.
- field key 정확히 한 번 배치·columns 2~4·중첩 금지·텍스트 상한과 legacy 출력 보존을 확인한다. 렌더러/버전 비교의 정규화를 이중 구현하지 않는다.
- hotspot 후보는 forms.ts·forms-routes.ts·admin-form-edit.tsx·permissions.ts·tenant.ts·org routes다. 구현 때 동시 변경이 있으면 카드에 hotspot을 남기고 소유 포트부터 나눈다. 이번 카드는 해당 코드를 수정하지 않는다.

## 10. 구현 단계와 검증

| 단계 | 산출물·선행 조건 | 통과 기준 |
|---|---|---|
| 0. 정책 확정(완료) | Q1~Q5 확정 기록 유지, Q5=A로 다른 key 연결 미지원·충돌 차단 | schemaVersion 1 범위 고정, 열린 질문 0건, 해결된 질문 재요청 금지 |
| 1. 도메인 스키마·diff | 순수 계약·안정 참조·정규화·허구 fixture | 미지 필드/인증 속성/중복/순환 거부, no-op·누락 유지·집합 교체·사번 비쓰기 시험 |
| 2a. RBAC 선행 | 역할·권한 저장 모델, builtin 이행, can/loadActor/가드/메뉴 전환 | 기존 매트릭스 동치, custom 생성/갱신·scope·간접 상승·캐시/권한 회수·RLS 시험. action 문자열 등록만으로 접근 허용 금지 |
| 2b. 식별·채번·초안 선행 | config_key backfill, account DB 경계, 회사 기본/override 저장, 초안 기준·정리·잠금 | 시스템 사번 발급·불변, 공유 user 보호, 원자성, 상속 영향 새 버전·기존 번호/순번 보존, 초안 ABA/동시성 시험 |
| 2c. 서비스·CLI | 소유 포트·preview·멱등성·export·인증 API 클라이언트 | 실제 PostgreSQL RLS/복합 FK/GRANT, 전체 롤백·감사 실패·만료·stale·동시 UI·인증/비밀값 무출력·CLI 종료코드 시험 |
| 3. 관리자 화면 | 다운로드·업로드·diff·확인·재인증·결과 | 1280px/360px 실제 화면·키보드·마스킹·재매핑·권한 증감. 서버와 같은 diff |
| 4. E2E·운영 문서 | 관리자/CLI 왕복, 두 테넌트·복원 시나리오 | no-op·누락 보존·기존 문서/PDF 불변·권한 상승/교차 계정 차단·초안 경합·채번 상속·다운로드 감사·상한·임시 객체 만료 |

각 단계는 재현 시험부터 RED→GREEN을 확인한다. 적용 마이그레이션 수정·의존성 추가·게이트 완화는 하지 않는다. 새 마이그레이션 feature 태그·@owner·RLS·GRANT·복합 FK 순서를 확인하고 배포 전에 migrate한다. 완료 기준은 pnpm verify와 관련 단위/통합, UI는 실화면·E2E, build·exact-head CI다. verify 자체는 lint·typecheck·arch:check·arch:guard이며 테스트/build를 포함하지 않는다. 공유 시험 DB에 병렬 실행하지 않고 격리 러너를 우선한다.

## 11. 이 문서 작업의 완료 기준

변경은 이 계획과 docs/INDEX.md뿐이다. 코드·의존성·게이트는 수정하지 않는다. 실제 pnpm verify, 머리말·JSON 예제·링크·소스 경로·제어 문자·diff 범위를 검사하고 카드에 기록한다. docs-only PR은 dev 대상이며 새 head의 CI 성공/skip을 구분한다. 향후 기능이 동작한다고 보고하지 않는다. 열린 제품 결정이 남으면 draft PR을 유지하고 needs_input으로 전환한다.

## 12. 확정 결정과 후속 과제

### 확정된 Q1~Q4

- Q1. 별도 구성 repo/앱 내 파일 보관 불필요. 초기 구성·파일 백업/복원, UI+CLI 유지, 공개 repo 실데이터 금지.
- Q2. 사번 자동 발급·불변, 최초 INSERT 보존도 금지. 별도 memberKey·참조 재매핑, 이메일 자동 병합 금지.
- Q3. 사용자 정의 역할·권한 생성 포함. 저장 모델·can() 이행·권한 승격 방지 선행. 임의 key가 새 기능을 구현하지는 않음.
- Q4a. 회사 공통 문서번호 기본 규칙+양식별 예외. 전사 통합 순번 없음. 기본 상속·실제 순번·기존 문서 보존 구분.
- Q4b. 문서함은 기존대로 유지하고 JSON/설정 개발에서 제외.

### 확정된 Q5=A. 다른 key의 기존 구성원 연결 미지원

같은 회사 key 복원과 빈 회사 신규 생성은 위 계약을 따른다. 다른 회사에 이미 같은 사람이 있으나 파일과 config_key가 다르면 v1에서는 연결하지 않는다. 이메일·사번 충돌이나 상충 정체성이 있으면 preview를 conflict로 표시하고 전체 apply를 차단한다. 사번·이메일을 이용한 자동 병합, 원본 사번 지정·변경, 계정 간 조회·쓰기 우회는 허용하지 않는다.

다른 회사로의 구성원 복원은 빈 대상 회사에서의 신규 시스템 채번까지만 지원한다. 이 제한·대상 사번 재매핑을 미리보기와 운영 안내에 표시하고, 기존 구성원 충돌 우회 옵션은 두지 않는다. Q1~Q5는 모두 확정됐으며 **열린 질문은 0건**이다.

후속 과제로만 관리자 명시 매핑과 계정별 import alias를 보류한다. 실제 기존 구성원 연결 요구가 생기면 별도 승인·계획에서 재인증·감사·반복 적용·다대일/출처 충돌 방지를 설계한다. v1의 스키마·서비스·CLI·UI·마이그레이션에는 매핑 옵션이나 alias 표를 추가하지 않는다.

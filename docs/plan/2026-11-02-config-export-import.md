---
title: 구성 설정 JSON 내보내기·임포트 계획
date: 2026-11-02
status: draft
tags: [config, org, approval, import, export, security]
related: [ORG-001, ORG-014, ORG-032, PERM-001, PERM-002, APV-004, APV-005, APV-006, AUD-020, AUD-022, docs/plan/2026-10-30-form-block-editor.md]
---

# 구성 설정 JSON 내보내기·임포트

이 문서는 구현 계획이다. 아래 CLI·API·새 권한·새 DB 경계는 **아직 없다**. 사용자 확정 요구와 설계 제안을 구분한다. 말미의 열린 질문을 확정하기 전에는 구현을 시작하지 않는다.

## 1. 목표와 확정 범위

2026-11-02 사용자 답변을 기준으로 다음을 지원한다.

- 조직 구조, 구성원, 양식, 양식별 기본 결재라인, 역할·권한, 회사 설정을 JSON으로 내보내고 가져온다. 같은 파일을 관리자 화면과 `pnpm` CLI에서 적용한다.
- 안정 key로 생성·갱신한다. JSON에 없는 항목은 삭제하거나 비활성화하지 않는다. 적용 전 실제 대상 회사와의 diff를 반드시 확인한다.
- 구성원 정보는 이름·이메일·사번·부서·직위·역할만 허용한다. PIN·패스키·세션·등록 토큰·초대 링크·비밀번호·공급자 계정·인증 검증 상태는 입출력 모두 금지한다.
- 양식이 달라지면 새 `form_version`을 만든다. 기존 문서의 `formVersionId`, 스냅샷, 본문, 검색 색인과 완료 패키지 `final/`은 바꾸지 않는다.
- 회사 관리자 권한을 검사하고, `account_id`와 RLS를 유지한다. 내보내기·임포트는 `audit_log` INSERT로 기록한다.
- JSON을 repo에서 관리한다. 단, **실제 구성원 개인정보를 현재 공개 앱 repo에 커밋하지 않는다.** 비공개 구성 저장소 분리는 12장 Q1의 승인 대상이다.

문서·첨부·완료 패키지·감사 이력·발령 이력·문서번호 현재 순번·양식 편집 초안·개인 즐겨찾기·알림·부재/대결은 구성 파일 대상이 아니다. 이 기능은 DB 복원이나 기존 계정 전체 내보내기 ZIP을 대체하지 않는다.

## 2. 현재 구현에서 확인한 제약

조사 기준은 `origin/dev`의 `4469be35bf16dbb35ff71484fd40f49886b634eb`이다. 경로는 repo 루트 기준이다. `pnpm feature:find "조직 양식 설정 권한"`으로 org·approval·account 영역을 좁혀 읽었다. 별도 settings 기능은 없고 회사 설정은 org가 제공한다.

| 대상 | 근거 | 설계에 미치는 영향 |
|---|---|---|
| 사업자·부서 | `packages/db/src/schema/org.ts`의 `business`, `department` | 사업자 code는 계정 안에서 고유, 부서 code는 **사업자 안에서만** 고유하다. 부서 code 단독 매칭은 금지한다 |
| 직위·직책 | 같은 파일의 `position`, `duty` | 이름만 고유하고 안정 code가 없다. 이름 변경을 upsert하려면 새 key 컬럼과 기존 데이터 연결 절차가 필요하다 |
| 사번 | `packages/db/src/schema/tenant.ts`, `packages/db/migrations/0027_member_identity.sql` | INSERT 시 P0000부터 자동 발급하고 UPDATE로 변경·비우기를 금지한다. INSERT에 명시한 사번은 현재 트리거가 보존한다. 스키마 주석의 0022 표기는 실제 파일과 다르므로 SQL 0027을 근거로 삼는다 |
| 사용자 이름·이메일 | `features/org/src/service/member-identity.ts`의 `changeIdentity` | `user`는 계정 공유 데이터다. 다른 회사에도 속한 사용자의 변경을 거부한다. 현재 함수는 자체 authDb 트랜잭션이라 업무 전체의 원자적 임포트에 그대로 중첩할 수 없다 |
| 신규 구성원 | `features/account/src/service/enrollment.ts`의 `preRegisterMember` | 사용자 생성과 멤버십 생성은 등록 토큰 발급과 분리돼 있다. 다른 회사 소속·패스키 보유·고아 계정의 이메일로 기존 사용자를 붙이지 않는다. 이메일 자동 병합은 금지한다 |
| 역할 | `shared/src/domain/permissions.ts`, `org.ts`의 `roleGrant` | `membership.role`은 owner/admin/member, 부가 역할은 business_admin/approval_admin/auditor/hr_admin이다. 권한 매트릭스는 코드 고정이고 사용자 정의 역할 표가 없다. PRD PERM-005는 P2다 |
| 양식 | `features/approval/src/service/forms.ts`의 `createForm`, `publishVersion`, `exportForm`, `importForm` | 기존 `fmerp-form/1`은 복제용 생성이며 upsert가 아니다. scope·recipients를 이식하지 않고 defaultLine에는 내부 ID가 남을 수 있어 새 구성 포맷으로 감싸는 것만으로는 부족하다 |
| 편집 초안 | 같은 파일의 `getFormDraft`, `saveFormDraft`, 블록 편집기 계획 4단계 기록 | 작성자별 schema/layout와 revision CAS가 있다. 초안을 내보내거나 임포트로 지우지 않는다. 공개 버전 변경과 초안 저장은 별도다 |
| 기본 결재선 | `features/approval/src/domain/approval-line.ts` | user/department/business_ceo 대상은 내부 ID, duty는 이름, drafter_head는 동적이다. 파일에서는 안정 참조로 바꿔야 한다 |
| 채번 | `shared/src/domain/doc-number.ts`, `forms.ts`의 `FormNumbering` | 규칙은 양식 버전에 있고 `doc_number_series`는 운영 상태다. 회사 공통 채번 기본값 표는 없다 |
| 문서함 | `features/approval/src/service/mailbox.ts`의 `MAILBOXES`, `boxCondition` | mine/upcoming/progress/completed/cc/receive/circulate/post/dept/audit는 코드 고정 조회다. 사용자 정의 회사 문서함 설정 표는 없다 |
| 회사 설정 | `features/org/src/api/org-routes.ts`의 `SettingsPatch` | name·allowedDomains·maxDeptDepth·approvalLineMaxCells·securityPolicy를 수정한다. allowAdminExport 변경은 소유자만 가능하다 |
| 저장소 공개 범위 | `gh repo view 4mcorp/fmERP --json visibility,url` | 조사 시 PUBLIC이다. 구성원 실데이터가 들어간 JSON을 이 repo에 올리는 설계는 채택할 수 없다 |

기준 규칙은 [database.md](../rules/database.md), [architecture.md](../rules/architecture.md), [api.md](../rules/api.md), [security.md](../rules/security.md)다. PRD 3.2·3.3, 5.2·5.3, 5.4.2, 5.5.3을 대조했다. 트러블슈팅의 복합 FK 생성 순서, Better Auth 우회 경로 차단, 동시 확인/쓰기 경합 규칙을 구현 검증에 반영한다.

## 3. JSON v1 계약 제안

### 3.1 외피와 누락 의미

- `format: "fmerp-config"`, `schemaVersion: 1`을 필수로 둔다. 알 수 없는 format·버전·속성은 거부한다. 미래 버전을 현재 버전으로 추측 변환하지 않는다.
- `settings`, `businesses`, `departments`, `positions`, `duties`, `members`, `roles`, `forms`를 선택 섹션으로 둔다. 섹션 누락과 빈 배열은 모두 기존 항목을 유지한다.
- 항목은 key와 변경할 필드만 가진 patch다. 필드 누락은 유지, nullable 필드의 명시적 null은 값 비우기다. 신규 항목은 생성 필수 필드가 모두 있어야 한다. `undefined`·빈 문자열을 null로 간주하지 않는다.
- 정체성 key를 제외한 배열은 기본적으로 **추가·동일 key 갱신**이다. 누락된 소속·역할 부여도 유지한다. 반면 `forms[].version`은 불변 버전의 완전한 정의이므로 `schema.fields`, `layout.blocks`, `defaultLine`, `recipients` 배열은 해당 버전 안에서 교체한다. 이 차이를 diff에 표시한다.
- `active`, 구성원 status, 유효 종료일, 삭제 지시어는 쓰기 계약에 넣지 않는다. 기존 비활성 항목은 유지하고 참조하면 오류로 처리한다. 내보내기는 활성 구성만 대상으로 하고 제외 건수를 별도 보고한다.
- `accountId`, DB UUID, DB version 번호, createdAt, 경로·SQL·실행 코드·S3 key를 구성 입력에 넣지 않는다. 대상 회사는 로그인 세션의 선택 계정에서 정한다. 출처 회사명·시각 등 내보내기 메타데이터는 별도 응답에만 둬 결정적 JSON을 유지한다.
- UTF-8 JSON만 받는다. 압축·원격 URL 참조·파일 include·환경변수 치환은 지원하지 않는다. 파서 단계에서 중복 JSON 속성도 거부한다. HTTP 본문 1MiB 상한과 같은 바이트 상한을 CLI에도 적용한다. 항목·중첩·텍스트 상한을 1단계 계약 시험에서 고정한다.

### 3.2 안정 key와 참조

| 엔티티 | 파일 key | 매칭 및 변경 규칙 |
|---|---|---|
| 회사 설정 | 파일 내 단일 `settings` | 현재 선택 회사만. account slug를 매칭이나 생성 권한으로 쓰지 않는다 |
| 사업자 | `code` | `(account_id, code)`. 다른 code에 같은 사업자등록번호가 있으면 자동 재연결하지 않고 충돌 |
| 부서 | `{ businessCode, code }` | `(account_id, businessCode, code)`. 부모 참조도 같은 객체 형태. 다른 사업자로 이동 금지 |
| 직위·직책 | `key` | 신규 `(account_id, config_key)` 컬럼을 제안한다. 이름은 표시 값. 기존 항목 최초 연결은 관리자 미리보기에서 명시적으로 승인하며 동명이름 자동 추측은 하지 않는다 |
| 구성원 | `employeeNo` | `(account_id, employee_no)`. 기존 사번 수정 금지. 같은 사번에 다른 이메일은 이름/메일 변경 후보이지 새 사람 생성이 아니다. 이메일만으로 사람을 바꾸지 않는다 |
| 역할 | `key` | v1 권고안은 고정 역할 키와 고정 permission 목록의 일치 확인. 임의 역할 생성은 Q3 결정 전 금지 |
| 역할 부여 | 사번 + 역할 key + scope | scope는 account, business(code), department(복합 key). JSON에서 빠진 부여는 유지 |
| 소속 | 사번 + 사업자 code + 부서 code | 같은 소속의 직위 갱신. 겸직은 추가만. 새 주소속이 기존 주소속과 충돌하면 자동 종료하지 않고 차단 |
| 양식 | `code` | `(account_id, form.code)`. 별도 key/code 이중 관리 없이 기존 code를 양식 key로 사용 |
| 문서함 | 고정 box key | 현행은 저장형 엔티티가 아니므로 v1에 새 설정을 임의로 만들지 않는다. Q4 결정 필요 |

사업자·부서·양식의 code와 새 config_key는 구성 관리에서 불변이다. key 변경을 이름 변경처럼 취급하지 않는다. 새 key는 새 항목을 만들고 이전 항목은 남으므로 미리보기에 경고한다. 기존 UI의 code 변경과 충돌하지 않게 해당 소유 기능의 수정 경계도 함께 정리한다. 직위·직책 key는 영문 소문자·숫자·`-`·`_` 1~64자, 첫 글자는 영문으로 제한한다. 기존 code와 사번은 현행 검증 계약을 따르고 임의 대소문자 변환으로 다른 항목을 합치지 않는다.

구성원 payload는 name·email·employeeNo·departments·roles만 받는다. `departments`는 businessCode·departmentCode·positionKey·isPrimary 참조 배열로, 부서·직위 허용 범위 안에서 겸직과 소속별 직위를 보존한다. 부서의 선택적 `headEmployeeNo`는 부서장 참조이며 구성원 생성·소속 연결 뒤에 적용한다. 직책 마스터는 조직 구조로 관리하지만 개인의 duty 배정은 구성원 허용 필드에 없으므로 임포트하지 않고 기존 값을 유지한다. 이로 인해 `duty` 결재 대상이 해결되지 않으면 양식 임포트를 차단하고 기존 조직 관리에서 배정하도록 안내한다.

### 3.3 양식·역할·회사 설정의 내용

`forms[]`의 meta는 name·category·scope다. `version`은 기존 `FormVersionInput`의 schema·layout·defaultLine·numbering·retentionYears·securityDefault·recipients·allowLineEdit·policy 전체다. scope·기본값·recipients 내부까지 UUID를 안정 참조로 왕복 변환한다. 인식하지 못하는 참조를 문자열 그대로 통과시키지 않는다.

- user 대상은 `employeeNo`, department 대상은 `{ businessCode, code }`, business_ceo는 `businessCode`와 선택 `positionKey`, duty는 `dutyKey`, drafter_head는 levels를 쓴다. 내부 `DraftLineItem`으로의 변환은 approval 소유 서비스가 맡는다.
- `FormSchema.fields[].key`와 `layout.blocks`의 field.key는 그대로 보존한다. 옵션 value·열 key도 보존한다. 블록 순서나 결재 순서를 정렬해 의미를 바꾸지 않는다.
- 양식 내 user/dept 기본값도 같은 안정 참조 계약으로 변환한다. 리치텍스트와 레이아웃 텍스트에는 실제 문서 내용이나 인증 정보를 넣지 않는다. HTML 정화·layout 검증을 재사용한다.
- `roles[]`의 permission은 임의로 실행 가능한 정책이 아니다. v1 권고안에서는 배포된 코드의 고정 매트릭스와 대조하며 불일치 시 적용을 차단한다. 사용자 정의 역할을 채택하면 별도 RBAC 설계·마이그레이션 단계가 선행한다.
- 계정 역할 admin 변경은 기존 role.grant 권한 규칙을 유지한다. owner는 검증용 참조만 가능하고 소유권 이전·소유자 생성·강등은 구성 파일로 하지 않는다. 실행자의 권한을 같은 임포트에서 변경하는 요청도 거부한다.
- settings는 현재 지원하는 회사 이름·allowedDomains·maxDeptDepth·approvalLineMaxCells와 securityPolicy의 명시 허용 필드만 받는다. timezone·locale은 현행 고정값을 검증만 한다. 토큰·SMTP·S3·DB 접속·서버 환경변수는 받지 않는다.
- 보안 정책은 인증 자격이 아니므로 설정 대상으로 두되 완화 변경을 diff에서 강조한다. `allowAdminExport`는 소유자만 변경한다. 관리자 자신이 내보내기 권한을 확장할 수 없어야 한다.
- 채번 rule·cycle·at는 양식 version의 numbering으로 관리한다. 회사 공통 기본 규칙을 신설할지와 문서함 설정은 Q4 결정 전까지 미지원 오류로 처리한다. `doc_number_series`와 `employee_seq`는 절대 내보내거나 갱신하지 않는다.

### 3.4 예시

다음은 허구의 조직과 부분 갱신 예시다. 신규 양식 생성 예시가 아니며 version을 생략하면 기존 공개 버전을 유지한다. `members`의 실데이터 파일은 공개 repo에 넣지 않는다.

```json
{
  "format": "fmerp-config",
  "schemaVersion": 1,
  "settings": { "maxDeptDepth": 2 },
  "departments": [
    {
      "businessCode": "DEMO",
      "code": "FINANCE",
      "name": "재무팀",
      "parent": null
    }
  ],
  "forms": [
    { "code": "GENERAL", "name": "일반 기안", "category": "일반" }
  ]
}
```

`DEMO`가 현재 회사에도 파일에도 없으면 참조 오류다. 신규 부서는 head를 나중 단계에서 연결한다. 이름·분류만 달라져도 요구사항에 따라 현재 version 정의를 복사해 새 form_version을 하나 만들고 meta를 갱신한다. 같은 파일의 재적용은 no-op이다.

## 4. 내보내기와 적용 순서

내보내기는 같은 DB 스냅샷에서 활성 설정과 각 양식의 최신 공개 버전만 읽는다. 내부 ID를 안정 key로 바꾸고, 엔티티 목록은 key 순서, 객체 속성은 고정 순서로 출력한다. 순서에 의미가 있는 배열은 보존한다. 같은 상태의 반복 내보내기는 같은 바이트와 해시를 만든다. 안정 key 미연결·무손실 표현 불가 항목은 조용히 생략하지 않고 전체 내보내기를 거부한다.

미리보기는 파일과 현재 DB 상태를 합친 **최종 후보 상태**를 만들어 다음 순서로 검증한다. 오류가 하나라도 있으면 적용하지 않는다.

1. 관리자 인증·대상 회사·재인증, 파일 크기·형식·버전·속성 허용 목록을 검사한다.
2. 섹션별 중복 key, 정규화 충돌, 사업자등록번호 체크섬·중복, 이메일·사번 충돌을 검사한다. UUID 참조나 인증 속성은 중첩 위치에서도 거부한다.
3. 최종 부서 그래프의 부모 존재·동일 사업자·순환·뎁스를 검사한다. 파일에 없는 기존 자식도 포함한다. maxDeptDepth 증가가 필요하면 먼저 올리고, 감소는 이동 후 최종 트리가 모두 맞을 때만 한다.
4. 사업자 → 직위·직책 → 부모 우선 부서(head 미연결) → 구성원 → 소속 → 부서장 → 역할 부여 → 양식·기본 결재선 순서로 계획한다. 구성원과 부서장 순환 참조를 두 단계로 푼다.
5. 사번과 이메일이 서로 다른 기존 사용자를 가리키거나, 새 사번에 이미 쓰인 이메일이 있으면 충돌이다. 타 회사 사용자 존재 여부는 응답에 드러내지 않는다. 공유 사용자의 이름·메일 변경은 거부한다.
6. 주소속 1개, 현재 소속·겸직 보존, 역할별 허용 범위, 비활성 대상 참조 금지를 확인한다. 소속 갱신은 org의 발령 이력을 남기며 이미 기안한 문서 스냅샷을 고치지 않는다.
7. `validateFormSchema`, `validateFormLayout`, `validateDocNumberRule`과 결재선 검증을 재사용한다. 동적 기안자 부서장 대상은 가능한 기안 소속별 해석 가능 여부를 검사해 실패 소속을 보여 준다. 기본 결재선 30단계와 계정 결재란 한도, scope·수신자·직책 참조도 확인한다.
8. 권한·초안 경합·채번 영향 검증 후 diff와 적용 계획을 반환한다. 단계적 커밋으로 일부 성공시키지 않고, 적용은 전체를 한 트랜잭션으로 처리한다.

양식 채번 규칙 변경은 이후 새 문서부터 적용한다. 기존 문서의 numbering 스냅샷·번호를 고치거나 순번을 되돌리지 않는다. 규칙 변경으로 기존 문서번호와 충돌 가능한 시리즈가 생기면 차단한다. 진행 중 문서와 조직 변경의 기존 보호 규칙을 우회하지 않는다.

## 5. 필수 미리보기 diff와 동시성

### 5.1 반환 계약 제안

`preview` 응답은 `planId`, `payloadHash`, `baseHash`, `expiresAt`, `summary`, `items`, `warnings`, `errors`, `canApply`를 가진다. planId는 추측 불가능한 식별자이고 사용자·계정·권한·파일 해시·기준 상태에 묶인다. 유효기간은 10분으로 제안한다. 해시는 무결성 비교이지 권한 증명이 아니다.

`items[]`는 entity, stableKey, operation(create/update/unchanged/conflict), changes, reasonCode다. `changes[]`는 JSON Pointer path와 before/after를 가진다. 양식은 `newVersion` 여부와 기준 공개 버전을 별도로 표시한다. summary는 엔티티별 건수이고 삭제/비활성 건수는 항상 0이다. conflict가 있으면 canApply=false다.

| entity | stableKey | operation | path | before | after |
|---|---|---|---|---|---|
| department | DEMO + FINANCE | update | /name | 재무 | 재무팀 |
| form | GENERAL | update, newVersion | /version/layout/blocks | 기존 블록 | 변경 블록 |
| member | P0001 | conflict | /employeeNo | 기존 사람 | 이메일 충돌, 적용 불가 |

개인정보 before/after는 권한 있는 화면에서만 보이고 기본 마스킹한다. CLI는 기본적으로 건수·필드명·오류 코드만 출력한다. 원본 JSON·diff 전체를 서버 로그·감사 로그·CI 산출물에 출력하지 않는다. 항목의 일부를 숨겼으면 숨긴 건수를 표시하고, 전체 변경을 확인하지 않은 상태로 적용 버튼을 열지 않는다. 권한 증가·보안 정책 완화·새 주소속 충돌·새 양식 버전·초안 존재를 강조한다.

### 5.2 적용 계약과 재시도

- 서버는 preview 시점의 계획을 클라이언트가 수정해서 보낸 값으로 실행하지 않는다. 서버 보관 payload와 기준 hash로 재계산한다. 보관은 테넌트 RLS와 접근 제한을 갖춘 단기 preview 표를 제안한다. payload는 애플리케이션 로그에 남기지 않고 만료 후 제거한다. 감사 로그는 이 정리 대상이 아니다.
- apply는 planId·payloadHash·확인값·멱등 키를 받는다. 현재 세션의 관리자 권한·재인증을 다시 검사한다. 새 실행 권한을 JSON이 부여했다고 이전 권한 검사에 사용하지 않는다.
- 트랜잭션에서 영향 행·양식 공개 버전을 잠그고 기준 상태를 재검증한다. 누락 항목의 신규 생성도 감지하도록 unique 충돌과 직렬화 실패를 다룬다. 다른 관리 경로도 같은 잠금 규약을 사용한다. 단순 임포트 전용 advisory lock만으로 일반 UI의 변경까지 막았다고 보지 않는다.
- 미리보기 이후 역할·부서·사용자·설정·공개 버전·초안이 달라졌으면 `409 config_preview_stale`로 전체 거부하고 다시 preview한다. 만료는 `config_preview_expired`, 같은 plan의 다른 payload는 `config_payload_mismatch`다.
- 같은 plan의 네트워크 재전송은 같은 적용 결과를 반환한다. 새 plan으로 동일 파일을 적용하면 변경 없음이며 form_version·발령 이력·권한 부여 행을 중복 생성하지 않는다. 적용 시도 감사는 별도로 남긴다.
- no-op 판정은 안정 참조로 변환한 도메인 값으로 한다. 객체 속성 순서나 필드 누락/default 차이는 정규화하지만, 필드·블록·결재선 배열 순서는 의미가 있으므로 보존한다. layout.blocks 없음과 명시적 단일 열은 기존 legacy-fields 출력이 다를 수 있어 무조건 같다고 취급하지 않는다.

## 6. 서비스 경계와 원자성

두 후보를 비교했다. org가 모든 테이블을 직접 쓰는 방식은 간단해 보이지만 approval·account 소유권을 침범한다. **구성 전용 기능과 소유 기능의 계약 주입**을 택한다. 새 기능의 비용은 있지만 서로 다른 정책을 복제하지 않는다.

제안 호출 표면은 `previewConfig(actor, account, payload)`, `applyConfig(actor, account, planId, idempotencyKey)`, `exportConfig(actor, account)`다. 시각·ID·해시 계산·DB 포트는 외부에서 주입한다. API와 CLI가 서로 다른 upsert를 구현하지 않는다.

- `features/config`의 domain은 JSON 계약·안정 참조·순수 diff만 소유한다. DB·네트워크·프레임워크를 import하지 않는다. service는 소유 기능 포트를 주입받아 계획·적용을 조정한다.
- org 포트는 조직·직위 key·소속·역할·회사 설정, approval 포트는 공개 양식·참조 변환·버전 생성, account 포트는 구성원 생성·정체성 변경을 소유한다. 감사는 `recordAudit`만 쓴다. 기능 간 직접 import는 하지 않는다.
- 합성 루트 `apps/web/server/app.ts`에서 포트를 연결한다. CLI는 DB 비밀번호와 actor 이메일을 받아 관리자를 자칭하는 스크립트가 아니라 **같은 인증 API를 호출하는 클라이언트**로 둔다. 브라우저의 정상 로그인·재인증을 통한 단기 CLI 세션 연결을 별도로 구현한다. 세션·연결 코드·재인증 값은 JSON·명령행 argv·콘솔·repo에 넣지 않고 보호된 로컬 자격 저장 경로로만 다룬다. 자격이 없으면 대화형 로그인으로 안내하며 우회 플래그는 제공하지 않는다.
- preview/apply의 업무 조회·변경은 `withTenant(appDb, accountId, tx => ...)`의 한 tx 안에서 한다. preview 상태도 같은 계정에 둔다. 새 표는 account_id·RLS·복합 FK·명시 GRANT·@owner를 갖춘다.
- 현재 `changeIdentity`/`preRegisterMember`는 자체 authDb 트랜잭션을 열므로 직접 재사용하면 부분 성공이 생긴다. **2단계 선행 작업으로 account 소유의 제한된 DB 경계**를 만든다. appDb tx에서 호출 가능한 좁은 SECURITY DEFINER 함수가 신규 user/membership 또는 이름·메일만 처리하고, 호출자 관리자 권한·현재 테넌트·대상 멤버십·다른 계정 소속 보호·이메일 충돌을 다시 확인한다. 고정 search_path·PUBLIC EXECUTE 회수·입력 제한과 감사/이력을 같은 tx에 포함한다.
- 이 경계는 인증 자격을 읽거나 쓰지 않는다. user 전체 DML 권한·BYPASSRLS를 config 기능에 부여하지 않는다. 다른 회사와 연결된 user는 수정하지 않고 충돌로 끝낸다. 타 회사 존재 확인은 이 보호 함수 내부의 최소 불리언 판정으로 제한하고 행을 노출하지 않는다.
- account 경계의 보안·원자성 통합 시험이 통과하기 전에는 구성원 쓰기를 활성화하지 않는다. 여러 authDb/appDb 트랜잭션을 순서대로 실행하고 원자적이라고 보고하지 않는다. 등록 링크 발급은 임포트가 하지 않으며, 신규 구성원은 관리자 기존 등록 절차를 별도로 밟는다.

새 export·preview API와 응답 타입은 구현 시 기능 지도에 등록하고 `feature:index`를 실행한다. 단일 소유 기능에 넣을지 새 기능으로 둘지는 구현자가 재결정하지 않도록 위 경계를 기준으로 한다.

## 7. 관리자 화면·CLI와 권한

### 7.1 권한 제안

신규 action `config.export`와 `config.import`를 `can()`에 추가한다. 둘 다 계정 범위 owner/admin만 허용하고 role_grant로 위임하지 않는다. 사업자·결재·인사 관리자와 감사인은 사용할 수 없다. 기존 `account.export`는 문서 전체 ZIP 권한이므로 재사용하지 않는다. 권한 신설은 이 계획의 기술 결정이며 새로운 사용자 정의 관리자 역할을 추가하는 것은 아니다.

미리보기와 적용 모두 config.import가 필요하다. 하위 소유 기능의 추가 보호도 검사한다. allowAdminExport 변경은 소유자만, ownership.transfer는 별도 화면만 허용한다. 관리자 화면에 버튼을 감추는 것으로 서버 검사를 대체하지 않는다.

새 API는 `/api/account/config/export`, `/api/account/config/preview`, `/api/account/config/apply`를 제안한다. 내보내기 준비와 다운로드에는 재인증을 요구하고 적용에도 같은 수준의 재인증을 요구한다. JSON 파일은 API 직접 첨부가 아니라 권한 확인 후 짧은 서명 URL로 다운로드한다. 저장은 `packages/storage`만 쓰고 `final/`과 별도 임시 키·짧은 수명·정리 경로를 둔다. 다운로드 URL 재발급마다 권한·재인증·감사를 확인한다. 미리보기 업로드는 크기 제한 내 JSON 요청으로 받는다.

### 7.2 화면 제안

회사 설정의 **구성 설정** 진입점에서 다음 흐름을 제공한다.

1. 내보내기 대상·개인정보 포함 경고 → 재인증 → 다운로드.
2. JSON 업로드 → 대상 회사명 표시 → 섹션별 diff·오류·경고 확인.
3. 변경 건수·권한 상승·새 양식 버전·회사명 확인 → 재인증 → 적용.
4. 성공·no-op·충돌 결과를 구분하고 요청 식별자를 표시한다. stale이면 재미리보기를 요구한다.

360px에서도 diff를 항목별로 열어 볼 수 있게 한다. 오류는 파일 경로가 아니라 JSON Pointer·엔티티 key·오류 코드로 찾는다. 실패 시 원문 전체나 다른 계정의 정보를 화면에 넣지 않는다.

### 7.3 CLI 제안

아래 명령은 **구현 예정 예시**이며 현재 실행할 수 없다.

```text
pnpm config:export --account <선택회사> --out <파일.json>
pnpm config:preview --account <선택회사> --file <파일.json>
pnpm config:apply --account <선택회사> --plan <planId>
```

preview는 계획 ID·만료·건수·오류를 보여 준다. apply는 서버에 보관된 동일 계획만 적용한다. 입력 파일을 바꿨으면 반드시 preview부터 다시 실행한다. 회사 선택은 세션이 속한 계정 중 하나만 가능하며 문자열 account 인자로 권한을 얻지 못한다. 대화형 apply는 대상 회사명과 변경 요약을 확인받는다. 비대화형 자동 적용·장기 서비스 토큰·`--force`·`--skip-preview`는 v1에서 제공하지 않는다. JSON을 repo에서 버전 관리하고 CLI로 수동 적용하는 요구부터 충족한다.

CLI 종료코드는 성공/no-op 0, 입력 검증 2, 인증·권한 3, stale·충돌 4, 내부 실패 1로 제안한다. API와 CLI가 같은 reasonCode를 사용하고 인증값은 stdout/stderr나 셸 히스토리에 남기지 않는다. 파일은 기본 0600으로 만들고 기존 파일 덮어쓰기는 명시 확인한다.

## 8. 감사와 개인정보

새 action은 `config.export`, `config.preview`, `config.apply`다. export는 스냅샷 준비와 실제 다운로드 URL 발급을 구분해 기록한다. 준비 완료를 클라이언트의 파일 수신 완료로 표현하지 않는다. 적용 성공/no-op과 실패를 모두 남긴다.

- accountId·actorUserId·UTC 시각·요청 ID·신뢰된 접속 IP·결과·대상 계정/생성된 엔티티 ID·변경 필드명·건수·서버 생성 planId를 기록한다. CLI도 서버에 인증된 실제 관리자와 채널을 기록하고 fake IP를 만들지 않는다.
- 이름·이메일·원문 JSON·diff 값·보안 자격·서명 URL·파일명은 일반 로그와 감사 reason/label에 넣지 않는다. 개인정보를 유추할 수 있는 원문 파일 hash도 감사에는 넣지 않고 서버 내부 plan 검증에만 쓴다. 역할 부여의 role·scope ID와 양식 버전 ID는 감사 대상 식별에 필요한 값으로 기록한다.
- 구성원 이름·메일 변경의 전후 값은 기존 전용 `member_identity_history`에만 기록하고 열람 권한을 유지한다. 기존 `changeIdentity`의 감사 diff를 그대로 복제해 개인정보를 확산하지 않는다.
- 적용 성공의 aggregate 감사와 하위 권한/양식/발령 행위 감사는 같은 tx에서 INSERT한다. 감사 INSERT 실패면 전체 롤백한다. 별도 attempt 식별자로 시작을 먼저 기록하고, 업무 tx 실패 뒤에는 정제된 실패 코드로 실패 감사 INSERT를 별도 tx에서 기록한다. 실패 감사도 저장하지 못하면 성공을 반환하지 않고 운영 경보를 낸다.
- 미리보기 조회 자체도 개인정보 조회 감사에 포함한다. preview 원문 보관·다운로드 객체·CLI 로컬 파일은 짧은 수명 또는 명시적 삭제 안내를 갖춘다. 감사 로그를 UPDATE/DELETE해 상태를 덮지 않는다.
- 공개 repo에는 스키마 설명과 허구 예제만 둔다. 구성원 실데이터·회사 기밀 설정은 접근 통제된 별도 저장소에서 검토하고 변경 이력을 보존하는 안을 권고한다. 개인정보가 git history에 영구 복제된다는 점을 Q1에서 확인한다.

## 9. 블록 편집기와의 충돌 지점

- 공개된 `form_version`만 export한다. `form_draft`의 schema/layout/revision과 브라우저 자동 저장 데이터는 export/import 대상이 아니다.
- 달라진 양식은 새 공개 버전 하나를 만들며 기존 문서 버전을 재연결하지 않는다. 동일 파일 재적용으로 버전이 늘어나지 않는다. meta-only 변경도 새 버전 정책을 따른다.
- 공개 대상 양식에 작성자별 초안이 하나라도 있으면 preview에 충돌을 표시하고 **해당 임포트 전체를 차단**하는 안을 택한다. 임포트가 초안을 덮거나 삭제해서 해결하지 않는다. 작성자가 기존 편집기의 명시적 저장으로 변경을 공개하거나, 별도 초안 정리 기능에서 정리한 뒤 다시 미리보기한다. 현재 공개 후 초안이 남는 구조이므로 단순히 다시 저장하는 것만으로 충돌이 해소됐다고 보지 않는다.
- 초안은 공개 후에도 남고 baseVersionId가 없다. 따라서 임포트 전용 우회/강제 덮어쓰기는 두지 않고, 편집기 5단계와 **초안의 기준 공개 버전 추적·명시적 정리 계약**을 먼저 맞춘다. 현재 revision CAS를 리셋하거나 0부터 다시 저장하면 오래된 탭이 살아나는 ABA 문제가 있으므로 tombstone 또는 단조 증가 revision을 유지하는 정리 방식을 설계한다.
- 임포트와 일반 `publishVersion`은 동일 form 행 잠금과 버전 유일성을 사용해야 한다. 현재 함수의 latest+1만으로 모든 경합이 해결됐다고 간주하지 않는다. 초안 생성/갱신도 이 잠금 규약에 참여해 preview 검사 직후 생기는 초안을 감지한다.
- layout.blocks의 field key 정확히 한 번 배치·columns 2~4·중첩 금지·텍스트 상한 검증을 재사용한다. 렌더러용 정규화와 버전 비교용 정규화를 별도로 만들지 않는다. blocks 없는 legacy 출력은 보존한다.
- hotspot 후보는 `forms.ts`, `forms-routes.ts`, `admin-form-edit.tsx`, `shared/src/domain/permissions.ts`, `tenant.ts`, org의 members/org routes다. 구현 단계에서 편집기 진행 브랜치와 겹치면 같은 파일을 동시에 확장하지 않고 소유 기능 포트부터 나눠 반영한다.

## 10. 구현 단계와 검증 기준

이 카드에서는 문서와 INDEX만 수정한다. 아래 단계는 승인 후의 구현 단위이며 새 의존성을 전제로 하지 않는다.

| 단계 | 산출물·선행 조건 | 통과 기준 |
|---|---|---|
| 0. 사용자 결정 | Q1~Q4 확정, 구성원/문서함 범위와 보관 위치 갱신 | 사용자 결정 기록, schemaVersion 1 범위 고정 |
| 1. 도메인 계약·검증 | 순수 JSON 스키마·안정 참조·정규화·diff, 허구 fixture | 잘못된 버전/미지 필드/중복 JSON key/중복 엔티티/순환/범위/인증 속성 거부. 동일 파일 no-op, 누락 항목 유지, 배열 교체 예외 시험 |
| 2. DB·소유 서비스·CLI | 직위/직책 key·기존 연결, 제한된 account DB 경계, preview·멱등성, 소유 기능 포트, 양식 잠금, 인증 API와 CLI | 실제 PostgreSQL RLS·복합 FK·GRANT·보호 함수·테넌트 격리, 공유 사용자 수정 거부, 새 구성원 생성, 고유 사번 충돌, 부분 실패 전체 롤백, 감사 실패 롤백, 만료·권한 회수·재시도·동시 관리 UI 변경 시험. CLI 공개 명령 종료코드·비밀값 무출력 시험 |
| 3. 관리자 화면 | 내보내기·업로드·diff·확인·재인증·결과 | 1280px/360px 실화면, 키보드 탐색·오류 포커스·개인정보 마스킹·충돌 상태. 동일 API와 diff 사용 |
| 4. E2E·운영 문서 | 관리자가 export→편집→preview→apply, CLI 왕복, 별도 두 테넌트 | 생성/갱신/no-op·누락 보존·기존 결재 문서/완료 PDF 불변·권한 상승 차단·초안 경합·다운로드 감사·다른 계정 참조 차단. 1MiB 상한·임시 객체 만료·복구 절차를 확인 |

각 단계는 재현 테스트부터 작성해 RED→GREEN을 확인한다. 새 DB 마이그레이션은 적용된 파일을 수정하지 않고 추가하며, 첫 줄 feature 태그·@owner·명시 권한·RLS·복합 FK 대상 UNIQUE 생성 순서를 검사한다. 배포 전에 migrate를 실행한다. 기능 지도·표 읽기 선언·exports·새 파일 배정을 맞춘다. 게이트 설정이나 허용 목록은 완화하지 않는다.

단계별 공통 완료 기준은 `pnpm verify`와 관련 단위/통합 시험이다. UI 단계는 실제 화면 확인과 E2E를 추가한다. build 검증과 CI는 실제 head SHA에 대해 확인한다. `pnpm verify`는 lint·typecheck·arch:check·arch:guard이고 테스트나 build까지 수행하는 명령은 아니므로 이 차이를 보고에 남긴다. 공유 테스트 DB에서 병렬 실행하지 않고 가능한 한 격리 러너를 쓴다.

## 11. 이 계획 문서의 완료 기준

- 변경은 `docs/plan/2026-11-02-config-export-import.md`와 `docs/INDEX.md`뿐이다. 구현 코드·의존성·게이트 변경은 없다.
- 현행 코드 근거와 제안 계약, 확정 요구와 열린 질문이 구분돼 있다. 개인정보·인증 정보·기존 버전·RLS 경계를 검토한다.
- `pnpm verify`를 실제 실행하고 결과를 카드에 남긴다. 문서의 로컬 링크·JSON 예제·머리말·제어 문자도 검사한다.
- docs-only PR은 dev 대상이다. 사용자 판단 대기 중에는 draft로 유지해 자동병합을 막는다. exact-head CI가 통과해도 Q1~Q4가 열려 있으면 카드를 완료하지 않고 needs_input으로 둔다.
- 문서 검증은 향후 기능 구현 검증이 아니다. 이 카드에서는 임포트 기능·화면·CLI가 동작한다고 보고하지 않는다.

## 12. 사용자 판단이 필요한 열린 질문

### Q1. 실제 JSON을 보관할 repo

현재 `4mcorp/fmERP`는 공개 저장소다. 이름·이메일·사번을 포함한 실데이터를 이 repo에 넣을 수 없다. **권고는 접근 통제된 별도 비공개 구성 repo**이며, 앱 repo에는 허구 예제와 포맷만 둔다. 이 구분으로 진행할지 결정이 필요하다. 저장소 공개 범위를 이 작업에서 바꾸지는 않는다.

### Q2. 신규 구성원의 사번 정책

기존 사번은 자동 발급·불변이다. 새 회사에 JSON으로 처음 구성원을 만들 때 **파일의 사번을 최초 값으로 보존**할지, 새 사번을 발급하고 원본 사번과 별도 mapping을 둘지 결정이 필요하다. 권고는 최초 INSERT만 파일 사번을 보존하고 기존 사번 UPDATE는 계속 금지하는 것이다. 이메일 일치만으로 기존 사람을 붙이지 않는다.

### Q3. role·permission의 수정 가능 범위

현행은 고정 역할·고정 권한 매트릭스다. JSON에서 **기존 역할 부여와 매트릭스 일치 검증만** 할지, PERM-005의 사용자 정의 역할·권한 편집까지 이번에 포함할지 결정이 필요하다. 권고는 v1에서 전자를 제공하는 것이다. 후자를 원하면 역할 표·권한 승격 방지·기존 can() 이행이 선행 단계로 추가되며, 고정 권한을 조용히 JSON으로 덮어쓰지 않는다.

### Q4. 회사 단위 채번·문서함의 의미

현행 채번은 양식별 numbering, 문서함은 코드 고정 조회다. **양식별 번호 규칙과 현재 문서함 체계의 검증으로 충분한지**, 아니면 회사 공통 채번 기본값·새 문서함 생성·표시명/정렬/노출 정책까지 원하는지 확인이 필요하다. 후자라면 원하는 설정 필드를 확정하고 저장 모델·권한을 별도 선행 단계에 포함한다. 현행에 없는 표를 가정해 지원한다고 적지 않는다.

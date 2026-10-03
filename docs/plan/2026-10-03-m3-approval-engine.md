---
title: M3 결재 엔진 (core, TDD)
date: 2026-10-03
status: done
tags: [approval, db, api, test]
related: [docs/plan/2026-10-03-mvp-roadmap.md, docs/rules/architecture.md, docs/rules/database.md, docs/rules/testing.md, docs/adr/0006-org-permission-model.md]
---

## 목표
화면이 없어도 결재가 **규칙대로 진행·완료·반려되는 엔진**을 만든다. 상태 전이는 모두 `packages/core`의 순수 함수를 거치고(architecture.md 3장), DB에는 그 결과를 안전하게 저장한다(낙관적 잠금·멱등·추가 전용 기록·무누락 채번·완료 후 불변). 화면(M4)·완료 패키지(M5)가 이 엔진 위에 올라간다.

## 범위
- **포함 (P0):** APV-030, 031, 032, 038, 040, 041, 045, 046, 050, 051, 053, 060, 061, 062, 090
- **함께 처리:** 결재선 해석(동적 대상 → 구체적 사용자, M2의 조직 데이터 사용), 상신 전 결재선 검증(APV-015 중 결재선 부분)
- **제외:** 양식·기안 화면·첨부·해시 기록(M4), 결재 PDF·완료 패키지·문서함·열람 권한(M5), 알림(M8), 위임전결 규정표·조건부 결재선(P1), 일괄 결재(P1)
- **UI 없음.** 서비스 함수와 통합 테스트로 검증한다. API 라우트는 결재 요청 생성(APV-090)과 부재 설정(APV-050·052의 서버 측)만 만든다.

## 사전 확인 — 적용할 트러블슈팅
| ts | 적용 |
|---|---|
| [drizzle-composite-fk-migration-order](../ts/2026-10-03-drizzle-composite-fk-migration-order.md) | 생성된 마이그레이션의 문장 순서를 확인한다. 적용 전 통합 테스트로 확인 |
| [pgboss-schema-permission](../ts/2026-10-03-pgboss-schema-permission.md) | 새 테이블 권한은 마이그레이션에서 역할별로 명시 부여 |
| [vitest-globalsetup-env](../ts/2026-10-03-vitest-globalsetup-env.md) | 통합 테스트 env는 `project.config.env` |
| [playwright-label-region-and-shell-heredoc](../ts/2026-10-03-playwright-label-region-and-shell-heredoc.md) | 긴 heredoc 대신 파일 도구 사용 |

## 설계

### 1. 도메인 모델 (용어는 GLOSSARY.md·ADR 0007로 고정)
| 개념 | 정의 |
|---|---|
| 문서 상태 | `DRAFT → IN_PROGRESS ⇄ ON_HOLD → COMPLETED / REJECTED`, `IN_PROGRESS → WITHDRAWN → DRAFT`, `COMPLETED → CANCELED / ARCHIVED` (PRD 5.4.1) |
| 단계 상태 | `PENDING → ACTIVE → APPROVED / REJECTED / HELD / SKIPPED / DELEGATED`, 후결 `POST_PENDING → POST_APPROVED` |
| 단계 유형 | 결재 · 합의 · 협조 · 감사 · 후결이 진행에 관여한다. 참조·수신·공람은 결재 진행에 영향이 없어 엔진은 저장만 하고 M5가 쓴다 |
| 진행 단위 | 같은 `seq`의 단계들이 한 **그룹**이다. 단일 단계도 크기 1의 그룹이다. 그룹이 완료되면 다음 `seq` 그룹이 활성화된다 |
| 처리 행위 | 승인, 반려, 보류·보류 해제, 전결, 동의·부동의, 감사 승인·감사 반려·의견, 후결 승인, 회수 |

### 2. `packages/core` 순수 함수 (TDD, 시각·ID는 인자로 주입)
| 모듈 | 내용 |
|---|---|
| `approval-state.ts` | 문서 상태 전이표. 허용되지 않은 전이는 오류 |
| `approval-line.ts` | 결재선 정의(단계·유형·대상·병렬 그룹·완료 조건), 그룹 활성화·완료 판정(전원 / N명), 건너뛰기(SKIPPED) |
| `approval-engine.ts` | `submit`, `act(document, step, action, actor, now)` → 새 상태 + 발생 이벤트 목록(`step_activated`, `completed`, `rejected`, `delegate_unavailable` 등). 부수효과 없음 |
| `approval-line-resolve.ts` | 동적 대상(기안자 부서장, 상위 N단계 부서장, 직책 = X, 사업자 대표이사)을 조직 스냅샷으로 사용자에게 해석. 해석 실패는 상신 차단 사유 |
| `approval-line-validate.ts` | 결재선 검증(APV-038, APV-015): 비활성·퇴사자 차단, 같은 사람 중복 경고(설정으로 허용), 서열 역순 경고, 본인만 있는 결재선 차단, 순환 금지 |
| `delegation.ts` | 부재 기간·범위(전체 / 양식 분류)로 대결자 결정. 연쇄 위임 금지, 대결자 부재 시 `delegate_unavailable` |
| `doc-number.ts` | 규칙 토큰(`{사업자코드}` `{부서코드}` `{양식코드}` `{YYYY}` `{YY}` `{MM}` `{SEQ:n}`) 렌더링, 시리즈 키(초기화 주기 연·월·없음) |

### 3. DB (모두 `account_id` + RLS, 테이블마다 권한 명시)
| 테이블 | 핵심 | 제약 |
|---|---|---|
| `document` (최소) | business_id, drafter 소속 스냅샷(jsonb), status, doc_no, source_type/id, 본문 자리(M4가 채움), submitted_at, completed_at | **완료 후 불변 트리거**: COMPLETED·ARCHIVED·CANCELED 문서의 본문·결재선 변경 거부(APV-062). 상태 전이만 허용되는 열을 구분 |
| `approval_step` | document_id, seq, parallel_group, type, target(jsonb), assignee 스냅샷, status, `version` | 낙관적 잠금: `UPDATE … WHERE version = ?` (APV-045). 완료 후 불변 트리거(후결 상태만 예외) |
| `approval_action` | step_id, actor_membership_id, on_behalf_of_membership_id, action, comment, ip, user_agent, 멱등 키 | **추가 전용**(INSERT·SELECT만), UNIQUE(step_id, idempotency_key) (APV-045·046). 문서 해시 열은 M4에서 값을 넣는다 |
| `doc_number_series` | business_id, key, last_seq | `SELECT … FOR UPDATE` 후 +1. 한 트랜잭션에서 누락·중복 없음 (APV-061) |
| `delegation` | membership_id, delegate_membership_id, from/to, scope(전체 / 양식 분류), created_by | 기간 겹침·자기 위임·연쇄 위임 금지 |

- 감사 로그: 상신·처리·회수·결재선 변경·부재 설정은 `recordAudit`에도 남긴다(`approval_action`은 법정 처리 기록, 감사 로그는 활동 기록으로 역할이 다르다).
- **서비스 위치:** `apps/web/server/approval/`(M2와 같은 방식). 엔진 호출 → 같은 트랜잭션에서 저장 → 이벤트는 `approval_event` outbox 행으로 저장(M5·M8·웹훅이 소비. M3에서는 소비자 없음).

### 4. 규칙 결정 (아래 "결정 필요" 확정 후 GLOSSARY·ADR 0007에 기록)
- 병렬 그룹 완료 조건: 전원 동의 또는 N명 동의. N명 달성 시 남은 단계는 `SKIPPED`
- 합의 부동의: 양식 설정 `반려로 처리 | 의견만 남기고 진행` (기본 반려)
- 반려 대상: 기안자(기본) 또는 직전 결재 단계(양식 옵션). 반려 사유 필수
- 보류: 현재 처리자가 보류하면 문서 `ON_HOLD`. 처리자 또는 결재 관리자가 해제
- 후결: 문서 완료를 막지 않고, 완료 후 `POST_PENDING` 단계가 후결 승인을 한다(완료 후 허용되는 유일한 추가 기록)
- 대결: 단계가 활성화될 때 부재 설정을 조회해 대결자를 정한다. 원 결재자와 대결자 모두 처리할 수 있고 먼저 처리한 쪽만 반영. 결재란 표시용으로 `on_behalf_of`를 기록. 연쇄 위임 금지
- 전결: 단계에 `전결 가능` 표시가 있는 처리자가 전결하면 이후 결재 단계를 `SKIPPED` 처리하고 문서를 완료한다(위임전결 규정표 연결은 P1)

## 단계
- [x] 1. 규칙 확정: 결정 Q1~Q9 승인(제안대로), 규칙을 GLOSSARY.md·ADR 0007에 기록
- [x] 2. `packages/core` (TDD, `tdd` 스킬): 상태 전이 → 결재선·그룹 → 엔진 → 해석·검증 → 대결 → 채번. 단위 테스트를 먼저 작성
- [x] 3. DB: 스키마·마이그레이션(RLS·권한·불변 트리거·추가 전용), 시드(기본 결재 시나리오용 조직은 M2 시드 재사용)
- [x] 4. 서비스(`apps/web/server/approval/`): 상신·처리·회수·보류·채번 저장, 낙관적 잠금·멱등 키, 이벤트 outbox, 감사 로그
- [x] 5. API: 결재 요청 생성(APV-090), 부재 설정·조회(APV-050·052 서버 측)
- [x] 6. 통합 테스트: 수용 기준 S3·S4와 동시성·불변 (아래 완료 기준)
- [x] 7. 보안 리뷰: 처리 권한 우회, 다른 사람 단계 처리, 대결 악용, 완료 후 변조
- [x] 8. 문서: TECH_SPEC·INDEX·rules(architecture·database·testing) 갱신, ts(발생 시)

## 완료 기준
- [x] 단위(순수 함수): 상태 전이표 전수(허용·거부), 그룹 활성화·전원/N명 완료·SKIPPED, 반려(기안자·직전 단계)·보류·전결·후결, 부동의 두 정책, 동적 대상 해석(부서장·상위 N단계·직책·사업자 대표이사)과 해석 실패, 결재선 검증 각 규칙, 대결 결정(기간·범위·연쇄 금지·대결자 부재), 문서번호 토큰·초기화 주기
- [x] 통합:
  - **S3:** 기안자 → 팀장(결재) → 재무팀(합의, 병렬 2명 전원) → 본부장 → 감사팀(감사) → 대표이사 순서 처리 후 문서번호 채번·COMPLETED, 모든 처리가 `approval_action`·감사 로그에 기록
  - **S4:** 본부장 반려(사유 필수) → REJECTED, 재기안은 새 초안으로 원문과 연결(데이터 수준)
  - **동시성(APV-045):** 같은 단계를 두 요청이 동시에 처리하면 한쪽만 반영, 같은 멱등 키 재요청은 같은 결과, 대결자·원 결재자 동시 처리는 먼저 온 쪽만 반영
  - **채번(APV-061):** 병렬 100건 채번에 누락·중복 없음, 시리즈 초기화 주기 동작
  - **불변(APV-062):** 완료 문서의 본문·결재선 수정이 API와 DB 직접 쓰기 모두 거부(후결 승인 제외). `approval_action` UPDATE·DELETE 거부
  - **권한:** 활성 단계의 처리자(또는 대결자)가 아니면 처리 거부, 타 계정 문서 접근 불가, 비활성 사용자 포함 결재선 상신 거부
  - **대결(APV-050·051·053):** 부재 중 대결 처리와 표시, 연쇄 위임 금지, 부재 설정 관리자 대행(APV-052 서버)
  - **테넌트 격리:** 신규 테이블 전부
- [x] lint · typecheck · 전체 테스트 · `next build`

## 결정 필요
| # | 항목 | 제안 |
|---|---|---|
| Q1 | M3의 DB·서비스 범위 | 위 설계대로 **엔진(core) + 최소 DB·서비스·통합 테스트까지** 포함. 화면과 양식·본문은 M4 |
| Q2 | 합의 부동의 기본 | 반려로 처리 (양식 옵션으로 의견만 진행 가능) |
| Q3 | 병렬 완료 조건 | 전원 동의 기본, N명 동의 옵션. N명 달성 시 남은 단계 SKIPPED |
| Q4 | 반려 대상 | 기안자 기본, 직전 단계 옵션 (직전 단계로 반려하면 그 단계가 다시 ACTIVE, 이력은 유지) |
| Q5 | 보류 | 처리자가 보류, 처리자 또는 결재 관리자가 해제 |
| Q6 | 후결 | 문서 완료를 막지 않고 완료 후에도 후결 승인만 추가 기록 허용 |
| Q7 | 감사 단계 | 감사 승인·반려·의견. 반려 가능 여부는 양식 옵션(기본 가능, 설정 화면은 M6) |
| Q8 | 이벤트 전달 | 같은 트랜잭션의 outbox 행으로 저장하고, 소비자(PDF·알림·웹훅)는 M5·M8에서 추가 |
| Q9 | 병행 | 순서대로 M3만 진행 (M2는 완료되어 병행 이점 없음) |

## 결정·변경 기록
- 2026-10-03: 초안 작성 (사용자 검토 대기)
- 2026-10-03: Q1~Q9 제안안대로 승인. 규칙 검증은 사용자 승인된 제안과 PRD 5.4를 대조해 진행(대화형 grill 없이), GLOSSARY.md·ADR 0007 작성
- 2026-10-03: 완료. 단위 155건·통합 133건, lint·typecheck·`next build` 통과. 보안 리뷰([m3-security-review](./2026-10-03-m3-security-review.md))에서 기안자의 권한 상승(전결·정책·번호 지정)을 막고, 부재 설정 시 진행 중 단계의 대결자 재계산을 추가. 후속 FU-11~15 기록. 처리 API·화면·재인증은 M4. 결재선 해석의 "직책 = X"는 기안자 사업자 안의 보유자, 부서 대상 any는 부서원 중 1명이다

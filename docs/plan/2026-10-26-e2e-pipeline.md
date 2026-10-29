---
title: E2E 러너 준비 비용·관측성 개선과 변경 관련 필수 CI
date: 2026-10-26
status: done
tags: [test, e2e, ci, k3s, performance]
related: [docs/rules/testing.md, docs/ops/k8s-test.md, docs/plan/2026-10-12-feature-scoped-ci.md]
---

## 목표
Linux 기반 테스트 DB·S3 격리와 기존 회귀 단언을 유지하면서 E2E의 대기·설치·개발 서버 컴파일 비용을 분리하고 줄인다. dev PR은 핵심 smoke와 변경 관련 E2E, main PR은 전체 E2E를 필수 check로 검증한다.

## 범위
- 포함: k3s 러너 종료·대기·산출물·단계 계측·의존성 캐시, 보수적 변경 관련 선택기와 CI, 명시적 production/staging E2E 실행 경로, 동일 자원 Linux Compose 비교, 실제 검증 및 성능 기록.
- 제외: OS 업그레이드, Aside 설치, 새 머신·새 패키지 도입, quota 상향, 운영 DB·S3 초기화, 보안 가드 완화, 자동병합.
- 기준 커밋: 최신 origin/dev cb9dcb4. 기존 7개 로케이터 수정은 PR #71에 이미 포함되어 있으므로 중복 구현하지 않는다.

## 합의한 검증 경계
1. 사용자 화면·동작: 기존 Playwright 테스트.
2. 변경 파일 → 실행 대상 선택: CLI 출력 및 종료코드.
3. 러너: 종료코드, 단계별 시간, 보관 산출물.
내부 구현에 결합한 테스트를 추가하지 않는다. 테스트 DB는 localhost 테스트 대상 검증을 유지하며 실행마다 초기화한다.

## 단계
- [x] 사용자 결정: dev 선택 E2E / main 전체 E2E, 커밋·푸시·dev PR까지, 병합 보류.
- [x] 최신 dev와 실제 기존 worktree 차이 확인, 독립 작업·기준선 worktree 생성.
- [x] 최신 dev의 기존 러너 전체 E2E 기준선 실행·자원 기록: 66 passed / 2 failed / 1 flaky / 3 skipped, Playwright 9.7분, 전체 641.77초.
- [x] 선택기 CLI RED→GREEN와 CI 필수 check 연결. 선택 실행은 검증한 기능 UI 경로에 한정하며, service/domain/API/jobs·지도·시험·공통/불명 변경은 전체 E2E로 폴백한다. 독립 리뷰의 런타임 교차 영향 지적을 반영해 6개 회귀 사례 RED→GREEN을 확인했다.
- [x] 러너 계약 RED→GREEN, 실행 대기·설치·시험·산출물 실검증.
- [x] 명시적 production 실행과 Linux Compose 비교. 동일 커밋·리소스·테스트 목록을 사용하고 cold/warm 차이를 구분한다.
- [x] 린트·타입·구조·단위·관련 통합·전체 E2E 검증과 독립 리뷰.
- [ ] 측정 결과·트레이드오프 문서 갱신, dev PR 생성, no-automerge 및 미병합 확인.

## 완료 기준
- 알 수 없는/shared 변경은 전체 E2E로 폴백하며 빈 선택으로 성공시키지 않는다.
- 파드가 종료되어도 로그·실패 산출물·단계 요약이 로컬에 남는다. 시험 실패를 성공으로 바꾸거나 부정확한 UNKNOWN으로 보고하지 않는다.
- 캐시는 서로 다른 실행의 DB·node_modules를 공유하지 않는다.
- production 실행은 기존 APP_ENV=staging 허용 경로만 사용하며 운영 로그인 차단 규칙은 그대로 둔다.
- 전체 실행 실제 결과와 실행 위치 비교 데이터를 PR에 기록한다. 관측하지 못한 성능 개선은 주장하지 않는다.
- typecheck, lint, arch:check, 관련 단위·통합 및 전체 E2E의 실제 결과를 기록한다.

## 결정·변경 기록
- 2026-10-26: 기존 관찰 실행의 14분 대기는 오래된 10Gi 러너의 quota 대기였다. 최신 dev 6Gi를 기준으로 비교하며 infra quota는 변경하지 않는다.
- 새 runner/CI 작업을 분리해 병렬 구현하되 부하를 발생시키는 E2E benchmark는 부모가 직렬 실행한다.
- 2026-10-26: Compose 준비 실검증에서 VM의 scratch 경로 미공유, 공유 네트워크 사전 검사, named volume과 non-root 이미지의 소유권 문제를 각각 확인했다. 네 번째 시도는 `tar: .: file changed as we read it`로 소스 준비 단계에서 중단됐다. 이 실행들을 production 빌드·브라우저 실패나 속도 비교로 해석하지 않는다.
- 사용자 재결정: **고정 소스 스냅샷을 Docker 볼륨으로 전달하도록 변경하고 실검증 계속**. live worktree·VM host bind 의존을 제거하고, 캡처·전달 실패 시 DB/S3 기동 전 실패하도록 한다. 새 패키지 설치나 VM 재시작은 하지 않는다. 구현·실검증을 마쳤다.

- 2026-10-26 실측(Linux Compose, production 모드, 고정 소스 스냅샷, 격리 DB·S3, `fix/e2e-pipeline`): smoke 4개 통과(118초), 전체 69 passed / 3 skipped / 0 failed / 0 flaky, Playwright 178.7초, 전체 234.7초(준비 4·설치 20·서비스 1·테스트 177초). 정리 후 컨테이너·볼륨·네트워크 잔존 없음.
- 기준선(k8s, dev 서버, 기존 PIN 절차)은 66 passed / 2 failed / 1 flaky / 3 skipped, 641.77초였다. 서버 모드·실행 위치·PIN 테스트 수정·캐시 상태가 동시에 달라 **개선 요인을 분리할 수 없다.** 요인별 단독 측정은 후속 과제이며, 위 수치로 k3s 전환이나 속도 개선 비율을 주장하지 않는다.
- 미검증: k3s 러너 취소·캐시 경로의 실제 Job, GitHub Actions 실행, actionlint, main 대상 PR 흐름.

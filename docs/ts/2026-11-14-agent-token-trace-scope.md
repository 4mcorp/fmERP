---
title: 토큰 E2E의 trace 옵션은 별도 spec 파일 단위로 설정한다
date: 2026-11-14
status: resolved
tags: [test, playwright, auth, security]
related: [apps/web/e2e/agent-token.spec.ts, docs/plan/2026-11-14-agent-token-b1.md]
---

## 증상과 원인

토큰을 trace에 남기지 않으려고 기존 m1.spec.ts의 describe 안에 `test.use({ trace: "off" })`를 넣었다. Playwright가 worker를 새로 만드는 옵션의 describe 설정을 거부하여 `--list`부터 실패했다. 이를 실행하는 단위 시험 account 선택도 실패했다.

## 해결

토큰 시나리오를 `agent-token.spec.ts`로 분리하고 trace 옵션을 파일 최상위에 둔다. feature-assignment와 account 지도의 E2E 목록에 파일을 배정한다. 기존 m1의 trace 설정은 변경하지 않는다. screenshot은 토큰 필드를 마스킹하고, 실패 시 error-context에 입력값이 남지 않도록 finally에서 화면을 다시 읽는다.

수정 후 실제 Playwright `--list`를 호출하는 e2e-select 단위 시험과 토큰 입력 계약은 2파일 31건 통과했다. 브라우저 실행 결과는 B1 카드의 최종 증거를 따른다.

## 재발 방지 규칙

- worker 단위 Playwright 옵션은 spec 최상위 또는 config에 둔다. describe 안에 두지 않는다.
- 비밀을 화면에 표시하는 시험은 trace·screenshot·실패 snapshot 모두를 검토한다. 테스트 계정이라도 생성된 토큰을 산출물에 넣지 않는다.
- 테스트 파일을 분리하면 기능 배정과 기능 지도를 갱신하고 실제 `--list`를 실행한다.
- 격리 러너에서 CLI 5초 제한이 실패하면 기대값을 늘리지 말고 동일 시험 단독 실행 및 `--maxWorkers=1`로 동시 부하를 제거한 전체 실행과 비교한다.

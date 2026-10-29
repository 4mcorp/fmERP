---
title: CI "connection refused"와 E2E 실패 원인 분석 (실제 run 로그 기준)
date: 2026-10-12
status: resolved
tags: [ci, e2e, playwright, db, test, flaky]
related: [.github/workflows/ci.yml, apps/web/playwright.config.ts, apps/web/e2e/global-setup.ts, docker-compose.dev.yml, apps/web/server/create-app.test.ts, features/completion/tests/jobs.int.test.ts]
---

## 증상

CI 실패 후 "connection refused"가 DB 준비 부족의 원인으로 의심되었다. 분석 카드(t_444d9f8f)에서 gh 인증 후 6개 실패 run의 로그를 직접 조회했다. 대상은 38113105491, 38109112733, 38109207138, 38109291671, 37948386265, 37492080859이다.

## 확정된 사실 (로그 근거)

- "connection refused" 문자열은 DB 장애가 아니다. `apps/web/server/create-app.test.ts`의 "DB 연결 실패는 503 Problem Details로 응답하고 내부 오류 내용을 노출하지 않는다" 시험이 DB 실패를 일부러 만든 로그다(run 37492080859, 37948386265의 같은 위치). 이 문자열만으로 실패 원인을 판정하지 않는다.
- run 38113105491, 38109112733, 38109207138, 38109291671, 37948386265 (PR 브랜치 wt/ui-org, wt/ui-t3-layout-shell, wt/ui-home, wt/ui-audit): 실패 단계는 모두 "E2E 테스트"이다.
  - 5개 run 모두 `locator.click` 30초 timeout이 나온다.
  - 38109112733, 38109291671은 `getByRole('link', { name: /결재 대기/ })`가 2개 요소로 해석되어 strict mode 위반이 난다. 두 요소는 `/approval/pending` 링크(본문 카드)와 같은 경로의 ghost 버튼이다.
  - 같은 run의 단위 테스트는 통과했다(37948386265: "Test Files 74 passed (74)").
- run 37492080859 (브랜치 refactor/feature-architecture, 2026-10-06): 실패 단계는 "단위·통합 테스트"이다. 실패 시험은 `features/completion/tests/jobs.int.test.ts`의 "스윕을 연달아 해도 같은 문서의 패키지는 한 번만 만들어진다"이다. 로그에 `waitFor`가 100초 뒤 "시간 안에 조건이 충족되지 않았습니다"로 끝난 기록이 있다. 같은 시점 worker 로그는 "양식 없이 만든 문서는 완료 패키지를 만들 수 없습니다"로 패키지 생성을 거부했다. 이 시험은 DB 연결 문제가 아니다.
- compose 기동은 실패 원인이 아니었다. 실패 run의 "Container fmerp-dev-postgres-test-1 Healthy"가 `docker compose ... up -d --wait` 직후 확인된다. 이 시점 이후 단계에서 DB 연결이 실패했다는 기록은 없다.
- 관찰만 한 경고: "Select is changing from uncontrolled to controlled" 콘솔 경고가 E2E 로그마다 있다. 실패와의 인과는 확인하지 않았다.

## 가설 (확인 못 함)

- E2E의 `locator.click` 30초 timeout 원인: 실패 시점 화면 상태(요소 미표시, 클릭 대상 가림 등)는 로그에 없어 확정할 수 없다. 원인 후보는 앱 화면 미구현과 locator 모호성이다.
- Playwright에서 webServer가 globalSetup보다 먼저 실행되어 `/api/health` 대기가 DB 초기화 전에 끝난다는 주장: 코더 코멘트의 추론이며 이 세션에서 실행으로 확인하지 않았다. `apps/web/playwright.config.ts`는 `webServer.url`을 `/api/health`로 두고 `reuseExistingServer: false`, `timeout: 120_000`이다. 실행 순서는 미검증이다.

## 원인 분류 (정리)

| run | 실패 단계 | 분류 | 상태 |
|---|---|---|---|
| 38113105491, 38109112733, 38109207138, 38109291671, 37948386265 | E2E 테스트 | 앱 화면/locator 문제 (strict mode, click timeout) | 확정: 실패 유형. 세부 화면 원인 미확정 |
| 37492080859 | 단위·통합 테스트 | 시험 데이터 문제: 양식 없이 만든 문서를 패키지 대상으로 씀 (추정) | 로그 근거 있음. 픽스처 코드는 미확인 |
| 모든 run | — | DB connection refused로 인한 실패 | 해당 없음 (로그 문자열은 의도된 시험 출력) |

## 해결과 검증

- 이 카드는 workflow, Playwright 설정, 테스트 코드를 바꾸지 않았다.
- 실제 로그 조회로 위 사실을 확정했다. 가설 항목은 확정하지 않았다.
- 후속 작업은 별도 카드로 나눈다: (1) E2E locator를 역할 기반으로 고정하고 strict mode 위반을 없앤다, (2) 실패 시점 스크린샷·trace를 CI 아티팩트로 남겨 click timeout 원인을 확정한다, (3) `jobs.int.test.ts` 픽스처에 양식을 연결한다.

## 재발 방지 규칙

- CI 로그에서 "connection refused"를 찾을 때는 실패 step의 에러와 함께 본다. 시험 이름이 `DB 연결 실패`인 로그는 의도된 출력이므로 원인으로 보지 않는다.
- CI 실패를 분석할 때는 `gh run view <id> --log-failed`로 실패 step 로그를 직접 확인하고, 그 결과를 근거로 분류한다. gh 인증이 없으면 분석을 완료로 표시하지 않는다.
- E2E에서 `getByRole`이 여러 요소를 잡으면 locator를 이름·경로로 좁힌다. timeout을 늘려서 덮지 않는다.
- webServer와 globalSetup의 실행 순서를 바꾸는 변경은 실행 로그로 순서를 확인한 뒤에만 한다. 추론만으로 설정을 바꾸지 않는다.

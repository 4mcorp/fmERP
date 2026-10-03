---
title: E2E가 개발 서버 첫 컴파일 지연으로 실패하고, 개발 DB 상태에 따라 결과가 달라짐
date: 2026-10-03
status: resolved
tags: [test, e2e, playwright, next]
related: [apps/web/playwright.config.ts, apps/web/e2e/global-setup.ts, apps/web/e2e/test-env.ts]
---

## 증상
1. 초대 흐름 E2E가 `toBeVisible` 5초 시간 초과로 실패했다. 화면은 이동 전 페이지 그대로였다.
2. 설계 중 확인: E2E가 개발 DB(55432)를 쓰면, 이전 실행에서 바뀐 상태(초대 수락, PIN 설정) 때문에 다음 실행이 실패한다.

## 원인
1. `next dev`는 페이지를 처음 열 때 컴파일한다(수 초). 기본 expect 대기 시간 5초를 넘겼다.
2. E2E가 상태를 바꾸는데, 실행마다 초기화하지 않았다.

## 해결
1. 페이지 이동을 `toHaveURL`로 명시적으로 기다리고, expect 대기 시간을 15초로 늘렸다.
2. E2E는 **테스트 DB(55433)** 를 쓴다. `global-setup.ts`가 실행마다 초기화(`resetTestDatabase`)하고 시드한다. 웹 서버는 `webServer.env`로 테스트 DB·포트 3100을 바라본다. 개발 서버를 재사용하지 않는다(`reuseExistingServer: false`).
3. 상태를 바꾸는 흐름에는 `@stateful` 태그를 달고, 모바일 프로젝트에서는 `grepInvert`로 제외한다(한 번만 실행).

## 재발 방지 규칙
- E2E에서 페이지를 옮기는 동작 뒤에는 `toHaveURL`로 이동을 먼저 확인한다.
- E2E·통합 테스트는 개발 DB를 쓰지 않는다. 테스트 DB 초기화는 `@fmerp/db/test/reset`(55433만 허용)을 쓴다.
- DB 상태를 바꾸는 E2E에는 `@stateful` 태그를 단다.
- Playwright 픽스처를 쓰지 않을 때 `({}, testInfo)`처럼 빈 구조분해를 쓰지 않는다 (Biome `noEmptyPattern`). 프로젝트별 제외는 태그와 `grep`·`grepInvert`로 한다.

## 재발 기록

---
title: Vitest 프로젝트의 test.env가 globalSetup에서 보이지 않음
date: 2026-10-03
status: resolved
tags: [test, vitest, config]
related: [vitest.config.ts, packages/db/test/global-setup.ts, packages/storage/test/global-setup.ts]
---

## 증상
`pnpm test:int` → globalSetup에서 `MIGRATION_DATABASE_URL이 없습니다` 오류가 나고, 이어서 `No test files found`로 끝났다 (테스트 파일 탐색 실패처럼 보이지만 실제 원인은 setup 실패).

## 원인
`test.env`는 **테스트 워커 프로세스**에만 주입된다. globalSetup은 메인 프로세스에서 실행되므로 `process.env`에 값이 없다.

## 해결
globalSetup이 Vitest 4가 넘겨주는 `TestProject`를 받아 `project.config.env`에서 값을 읽도록 바꿨다 (`import type { TestProject } from "vitest/node"`).

## 재발 방지 규칙
- globalSetup에서는 `process.env` 대신 `project.config.env`를 읽는다.
- `No test files found`가 나오면 그 위의 Unhandled Error(설정 실패)부터 확인한다.

## 재발 기록

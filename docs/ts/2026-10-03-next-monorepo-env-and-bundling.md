---
title: Next(모노레포)에서 루트 .env가 안 읽히고, 공유 패키지의 new URL(...)이 번들 오류를 냄
date: 2026-10-03
status: resolved
tags: [next, build, env, monorepo, db]
related: [apps/web/next.config.ts, packages/db/package.json, packages/db/src/migrate.ts]
---

## 증상
1. `pnpm dev` 후 `/api/health`가 500. 오류: `Module not found: Can't resolve '../migrations'` (`packages/db/src/migrate.ts`의 `new URL("../migrations", import.meta.url)`)
2. 1을 고친 뒤에도 `/api/health`가 503. 서버 로그: `ZodError ... DATABASE_URL expected string`

## 원인
1. `@fmerp/db`의 진입점(`index.ts`)이 마이그레이션 모듈까지 내보내서, Turbopack이 `new URL(..., import.meta.url)`을 정적 자산으로 해석해 `migrations` 폴더를 번들링하려 했다.
2. Next는 시작할 때 `apps/web` 기준으로 env를 이미 읽어 캐시한다. `next.config.ts`에서 호출한 `loadEnvConfig(루트)`는 4번째 인자 `forceReload` 없이 호출되어 캐시 때문에 무시됐다.

## 해결
1. `runMigrations`를 진입점에서 빼고, 별도 진입점 `@fmerp/db/migrate`(package.json `exports`)로 분리했다.
2. `loadEnvConfig(repoRoot, dev, undefined, true)`로 루트 `.env`를 강제로 다시 읽도록 했다. `/api/health`가 200을 반환하고 E2E도 통과한다.

## 재발 방지 규칙
- 웹 앱이 import하는 공유 패키지의 진입점에는 **Node 전용 파일 시스템 경로**(`new URL(..., import.meta.url)`, `__dirname` 기반 경로)를 쓰는 모듈을 넣지 않는다. 별도 `exports` 경로로 분리한다.
- 모노레포 루트 `.env`를 Next에서 쓸 때는 `forceReload`를 켠다.
- 헬스체크처럼 원인을 응답에 숨기는 경로는 서버 로그에 원인을 남긴다 (ADR 0003).

## 재발 기록

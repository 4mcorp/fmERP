---
title: Windows에서 pnpm이 PATH에 없어 스크립트·도구가 실패함 (corepack enable은 관리자 권한 필요)
date: 2026-10-03
status: resolved
tags: [windows, pnpm, corepack, deps, build]
related: [package.json, README.md, docs/rules/dependencies.md]
---

## 증상
- `corepack enable` → `EPERM: operation not permitted, open 'C:\Program Files\nodejs\pnpm'`
- `pnpm typecheck`처럼 **루트 스크립트 안에서 `pnpm -r ...`을 다시 호출**하면 `'pnpm'은(는) 내부 또는 외부 명령... 아닙니다`로 실패
- `shadcn init`이 내부적으로 `pnpm add`를 호출하다 같은 이유로 실패

## 원인
- Node가 `C:\Program Files\nodejs`에 설치되어 있어, corepack이 그 폴더에 pnpm 실행 파일을 만들려면 관리자 권한이 필요하다.
- npm 전역 폴더(`%APPDATA%\npm`)도 사용자 PATH에 등록되어 있지 않다.
- `corepack pnpm ...`으로 실행하면 그 프로세스 자체는 동작하지만, 스크립트가 다시 부르는 `pnpm`은 찾지 못한다.

## 해결
- 에이전트 작업: scratchpad에 `pnpm.cmd`(`@corepack pnpm@11.28.3 %*`)와 sh용 `pnpm`을 만들고, **해당 명령에서만** PATH 앞에 붙여 실행했다. 사용자 환경 변수는 바꾸지 않았다.
- 개발자 1회 설정(README "개발 환경 준비"): 관리자 PowerShell에서 `corepack enable`을 1회 실행한다.

## 재발 방지 규칙
- 개발 PC에서 `pnpm --version`이 실패하면 사용자에게 README의 1회 설정을 안내한다. 사용자 PATH·환경 변수를 에이전트가 임의로 바꾸지 않는다.
- 사용자 설정 전에 에이전트가 pnpm을 써야 하면 `corepack pnpm@11.28.3 <명령>`을 쓴다. 중첩 호출이 필요한 스크립트는 임시 shim을 PATH 앞에 붙여 실행한다.
- 다른 도구(shadcn 등)가 패키지 매니저를 내부 호출할 수 있음을 전제로, 실행 전에 PATH에 pnpm이 있는지 확인한다.
- 대화형 프롬프트가 나올 수 있는 CLI는 `< /dev/null`과 시간 제한(`timeout`)을 걸고 실행한다. shadcn은 `-p nova --no-reinstall` 같은 옵션을 명시해야 묻지 않는다.

## 재발 기록

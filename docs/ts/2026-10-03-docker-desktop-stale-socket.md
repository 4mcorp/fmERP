---
title: Docker Desktop 엔진이 시작되지 않음 (오래된 dockerInference 소켓 파일)
date: 2026-10-03
status: open
tags: [docker, windows, infra, test]
related: [docker-compose.dev.yml, docs/adr/0004-integration-test-db.md]
---

## 증상
Docker Desktop 4.81.0을 실행해도 `docker info`가 계속 다음 오류를 낸다. WSL의 `docker-desktop` 배포판은 `Stopped` 상태로 남는다.
```
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine
```
`%LOCALAPPDATA%\Docker\log\host\com.docker.backend.exe.log`에는 다음 기록이 있다.
```
backend crashed ... initializing Inference manager: listening on unix://C:/Users/<user>/AppData/Local/Docker/run/dockerInference:
remove .../Docker/run/dockerInference: The file cannot be accessed by the system.
```
화면에는 "Quit / Reset to factory defaults" 오류 대화상자가 떠 있다.

## 원인
이전 실행(2026-07)에서 남은 Unix 소켓 파일(재분석 지점, 0바이트)을 Docker Desktop이 지우지 못해, Model Runner(Inference) 서비스가 시작에 실패하고 백엔드 전체가 멈춘다.

## 해결 (미적용 — 사용자 결정으로 보류)
1. Docker Desktop을 완전히 종료한다 (트레이 아이콘 → Quit).
2. `%LOCALAPPDATA%\Docker\run\`의 `dockerInference`, `dockerEthernetVfkit`, `userAnalyticsOtlpHttp.sock`을 삭제한다. 시작할 때 다시 만들어진다.
3. Docker Desktop을 다시 시작한다. 계속 실패하면 설정에서 Docker Model Runner를 끈다. 이 프로젝트는 Model Runner를 쓰지 않는다.

## 재발 방지 규칙
- Docker 작업 전에 `docker info`로 엔진 응답을 먼저 확인한다. 응답이 없으면 위 로그 파일에서 `backend crashed`를 검색해 원인을 확인한다.
- Docker Desktop 앱 종료나 앱 데이터 삭제는 사용자 확인을 받은 뒤 진행한다.

## 재발 기록

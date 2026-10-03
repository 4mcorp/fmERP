---
title: Windows에서 Biome 실행이 EPERM으로 실패하거나, hook에서 조용히 아무것도 하지 않음
date: 2026-10-03
status: resolved
tags: [windows, biome, claude-code, hooks, lint]
related: [.claude/hooks/format-file.mjs, biome.json]
---

## 증상
1. 설치 직후 `pnpm lint` → `spawnSync ...\biome.exe EPERM`. 잠시 뒤 다시 실행하면 정상이었다.
2. PostToolUse hook(`format-file.mjs`)이 오류 없이 끝나지만 파일이 포맷되지 않았다.

## 원인
1. 새로 받은 `biome.exe`(약 79MB)를 백신이 검사하는 동안 실행이 막힌 것으로 추정한다(재시도 시 4회 연속 정상).
2. 두 가지가 겹쳤다.
   - Biome에 **Windows 역슬래시 절대 경로**를 넘기면 `Formatted 0 files`로 아무 파일도 매칭하지 않는다.
   - Biome의 Node 런처를 `stdio: "ignore"`로 실행하면 실제 실행 파일이 조용히 실패한다.

## 해결
- hook에서 파일 경로를 **프로젝트 기준 상대 경로(`/` 구분자)** 로 바꿔 넘기고, `stdio: "pipe"`로 실행한다. 수정 후 샘플 파일이 포맷되는 것을 확인했다.
- 테스트 입력 JSON은 셸 이스케이프가 깨지기 쉬우므로 파일(python `json.dumps`)로 만들어 stdin에 넣었다.

## 재발 방지 규칙
- Biome·lint 도구에는 Windows 절대 경로 대신 **프로젝트 기준 상대 경로(`/`)** 를 넘긴다.
- Node에서 Biome를 자식 프로세스로 실행할 때 `stdio: "ignore"`를 쓰지 않는다.
- hook·스크립트를 만들면 "오류 없이 끝남"이 아니라 **실제 결과(파일 변경)** 로 검증한다.
- 실행 파일이 EPERM으로 실패하면 한 번 재시도한다. 재시도로 통과하면 이 문서의 재발 기록에 남기고, 코드 문제로 오인해 설정을 바꾸지 않는다.

## 재발 기록
- 2026-10-03: 설치 후 시간이 지난 뒤에도 `pnpm lint`가 간헐적으로 EPERM으로 실패하고, 재실행하면 통과했다 (2회 중 1회). 백신 실시간 검사가 원인으로 추정된다. **대응 제안(사용자):** Windows 보안 → 바이러스 및 위협 방지 → 제외 항목에 `E:\LAB\4mERP\node_modules`(또는 pnpm 저장소 `E:\.pnpm-store`)를 추가한다.

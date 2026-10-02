---
title: Windows에서 MCP 서버를 npx로 직접 실행하면 시작되지 않음
date: 2026-10-03
status: resolved
tags: [windows, mcp, npx, claude-code]
related: [.mcp.json, docs/TECH_SPEC.md]
---

## 증상
`.mcp.json`에 `"command": "npx"`로 shadcn MCP를 등록했는데, 이 Windows PC에서는 서버가 시작되지 않았을 것으로 확인됨. Node로 같은 방식을 재현한 결과:
```
spawn('npx', ['--version'])          → error ENOENT
spawn('cmd', ['/c','npx','--version']) → 11.9.0 (정상)
```

## 원인
Windows의 `npx`는 실행 파일이 아니라 `npx.cmd` 배치 파일이다. 셸 없이 프로세스를 띄우면(MCP 클라이언트의 stdio 실행 방식) 찾지 못한다.

## 해결
- shadcn: `"command": "cmd", "args": ["/c", "npx", "-y", "shadcn@4", "mcp"]`로 변경. MCP `initialize` 요청에 정상 응답하는 것을 확인함.
- Context7: 로컬 프로세스 대신 원격 HTTP 방식(`"type": "http"`)으로 등록해 운영체제 문제를 피함.

## 재발 방지 규칙
- Windows용 MCP 설정에서 `npx`, `pnpm`, `pnpx`로 실행하는 서버는 `cmd /c`로 감싼다.
- 원격(HTTP) 방식을 제공하는 MCP 서버는 원격 방식을 우선 고려한다.
- MCP 설정을 추가하거나 바꾸면 `initialize` 요청으로 실제 응답을 확인한 뒤 완료로 보고한다.
- `cmd /c` 설정은 macOS·Linux에서 동작하지 않는다. 그쪽 개발자는 local 범위로 덮어쓰도록 안내한다 (TECH_SPEC 7장).

## 재발 기록

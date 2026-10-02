---
title: 조건부 재검토 대상 Claude 부가 도구
date: 2026-10-03
status: parked
tags: [claude-code, tokens, tooling]
related: [docs/HARNESS_CANDIDATES.md]
---

## 내용
[HARNESS_CANDIDATES.md](../HARNESS_CANDIDATES.md)에서 지금은 보류했지만, 조건이 맞으면 다시 검토할 도구들.

| 도구 | 기대 효과 | 재검토 조건 |
|---|---|---|
| Serena MCP | 코드 읽기 입력 토큰 절감 | 코드가 5만 줄을 넘을 때 |
| context-mode | 큰 로그·브라우저 출력을 컨텍스트 밖에 보관 | 로그 분석 작업이 잦아질 때 |
| hookify (공식 플러그인) | 반복 실수를 차단하는 hook 자동 생성 | 같은 실수가 ts에 2번 이상 기록될 때 |
| 공식 code-review / pr-review-toolkit | 다중 에이전트 PR 리뷰 | PR 기반 개발로 바꿀 때 |

## 장단점
도입 전 ccusage로 기준선을 잡고, 하나씩 넣어 같은 작업으로 비교한다. 측정된 효과가 없으면 제거한다.

## 재검토 조건
위 표의 조건별로 판단한다.

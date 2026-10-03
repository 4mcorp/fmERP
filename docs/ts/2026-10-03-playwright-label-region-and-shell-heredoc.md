---
title: getByLabel이 aria-labelledby 영역을 먼저 잡고, 셸 heredoc·파이썬 보조 편집이 멈춤
date: 2026-10-03
status: resolved
tags: [test, e2e, playwright, windows, tooling]
related: [apps/web/e2e/m2.spec.ts]
---

## 증상
1. `getByLabel("역할")`이 선택 상자가 아니라 `<section aria-labelledby>`(제목이 "역할")를 먼저 찾아, 옵션을 못 찾고 시간 초과.
2. `li`에 `hasText`로 중첩된 트리 항목을 찾으면 조상 항목까지 걸려 strict mode 위반.
3. 한글·따옴표가 섞인 긴 Bash heredoc이 `unexpected EOF`로 실패하고, `python -`가 입력을 기다리며 멈춰 뒤늦게 이어진 명령이 파일을 일부 고쳤다.

## 해결
- 선택 상자는 `getByRole("combobox", { name })`으로 찾는다. 트리 행의 버튼에는 `aria-label`에 항목 이름을 넣어(`자금파트 하위 추가`) 접근성도 높이고 테스트도 유일하게 만든다.
- 파일 수정은 Write·Edit 도구나 `node` 스크립트 파일로 하고, 스크립트는 만든 뒤 지운다.

## 재발 방지 규칙
- 폼 컨트롤은 role(combobox, textbox)로 찾는다. `getByLabel`은 영역(region)도 잡는다.
- 중첩 목록의 행 단위 동작 버튼은 항목 이름이 들어간 접근 가능한 이름을 준다.
- 긴 heredoc·`python -` 대신 파일 도구를 쓴다. 보조 스크립트 뒤에는 `git status`로 의도치 않은 수정이 없는지 본다.

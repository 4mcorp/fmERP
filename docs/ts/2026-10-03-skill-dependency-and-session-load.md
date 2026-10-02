---
title: 설치한 스킬이 다른 스킬을 호출하는데 그 스킬이 없음 / 설치 직후 스킬 호출 실패
date: 2026-10-03
status: resolved
tags: [skills, claude-code]
related: [skills-lock.json, docs/TECH_SPEC.md]
---

## 증상
1. `grill-me` 스킬 본문이 `Call the Skill tool with "grilling"` 한 줄뿐인데, `grilling`이 설치되어 있지 않았다. `tdd`도 `codebase-design`을 참조했다.
2. 세션 도중에 설치한 `git-commit`을 바로 호출하자 `Unknown skill: git-commit` 오류가 났다.

## 원인
1. `npx skills add -s <이름>`은 지정한 스킬만 설치하고, 그 스킬이 참조하는 다른 스킬은 설치하지 않는다.
2. 스킬 목록은 세션이 시작될 때(또는 이후 갱신 시점에) 로드된다. 설치 직후 같은 턴에서는 아직 인식되지 않을 수 있다.

## 해결
1. `grilling`, `codebase-design`을 추가로 설치했다.
2. 해당 스킬의 SKILL.md 절차를 직접 따라 작업을 마쳤다. 이후 시스템이 스킬 목록을 갱신해 인식되었다.

## 재발 방지 규칙
- 스킬을 설치한 뒤 다음 명령으로 참조하는 스킬을 찾아, 빠진 것이 있으면 함께 설치한다.
  ```bash
  grep -rhoE 'Skill tool with "[a-z0-9-]+"' .claude/skills/*/SKILL.md | sort -u
  ```
- 설치한 스킬은 SKILL.md를 읽고 위험한 지시(원격 스크립트 실행, 자격 증명 접근, 지시 무시 유도)가 없는지 점검한 뒤 커밋한다.
- 방금 설치한 스킬이 인식되지 않으면, SKILL.md 절차를 직접 따르거나 새 세션에서 사용한다.

## 재발 기록

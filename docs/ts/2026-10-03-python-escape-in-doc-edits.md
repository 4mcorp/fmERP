---
title: 스크립트로 문서를 고칠 때 Windows 경로의 백슬래시가 제어 문자로 바뀜
date: 2026-10-03
status: resolved
tags: [docs, windows, tooling]
related: [docs/INDEX.md, docs/rules/docs.md]
---

## 증상
Python 스크립트(일반 문자열)로 Markdown을 고쳤더니 `` `Docker\run` ``이 `Docker` + 캐리지 리턴 + `un`으로, `E:\LAB\4mERP\node_modules`가 `E:\LAB` + `\x04` + `mERP` + 줄바꿈 + `ode_modules`로 저장됐다. 같은 실수가 두 번 일어났다.

## 원인
일반 문자열에서 `\r`, `\n`, `\4` 같은 조합이 이스케이프 시퀀스로 해석됐다.

## 해결
raw 문자열(`r"..."`)로 해당 줄을 다시 썼다. 문서 전체에서 제어 문자가 없는지 검사했다.

## 재발 방지 규칙
- Windows 경로나 백슬래시가 들어간 텍스트는 스크립트 대신 **Edit/Write 도구**로 고친다. 스크립트를 써야 하면 raw 문자열을 쓴다.
- 문서를 스크립트로 일괄 수정한 뒤에는 제어 문자를 검사한다.
  ```bash
  python -c "import pathlib,re; print([str(p) for p in pathlib.Path('.').glob('**/*.md') if 'node_modules' not in p.parts and '.claude' not in p.parts and re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', p.read_text(encoding='utf-8'))] or 'none')"
  ```

## 재발 기록
- 2026-10-03: 처음 적었던 `grep -rlP` 검사는 이 PC(Git Bash 로케일)에서 `-P supports only unibyte and UTF-8 locales`로 실행되지 않았는데, `|| echo`로 이어 붙여 "문제 없음"으로 잘못 보였다. Python 검사로 바꿨다. 검사 명령은 실패를 숨기지 않게 쓴다.

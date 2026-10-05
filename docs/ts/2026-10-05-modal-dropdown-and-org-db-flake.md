---
title: 모달 안 드롭다운이 모달을 닫아 버림, 그리고 org-db 테스트가 가끔 실패함
date: 2026-10-05
status: resolved
tags: [ui, modal, select, test, flaky, db]
related: [apps/web/components/ui/modal.tsx, apps/web/components/ui/select.tsx, apps/web/server/org-db.int.test.ts]
---

## 증상 1 — 모달 안 드롭다운
- 공람 지정 모달에서 대상 선택 상자를 누르면 목록이 열리지 않고 **모달 전체가 닫힌다**. (E2E는 "선택지를 찾지 못함"으로 실패, 자동 테스트만으로는 원인을 알 수 없었고 개발 서버에서 실제 마우스로 눌러서 재현했다.)
- 처음에는 드롭다운이 body에 그려져 `<dialog>`(top layer) 밖이라 클릭이 막혔다("html intercepts pointer events").

## 원인 1
1. Radix Select의 목록은 기본으로 body에 포털로 그려진다. `<dialog>.showModal()`이 만든 top layer 바깥은 클릭할 수 없다.
2. 목록을 모달 안에 그리게 하자, 실제 마우스 클릭에서 `mousedown`은 트리거, `mouseup`은 펼쳐진 목록에 떨어진다. 브라우저는 이때 클릭 이벤트를 **공통 조상인 `<dialog>` 자신**에 보낸다. 모달의 "배경 클릭으로 닫기"가 `e.target === dialog`만 봐서 이를 배경 클릭으로 오인했다. (프로그램으로 `.click()`을 호출하면 재현되지 않는다.)
3. 렌더마다 새 함수를 `ref`로 주면 React가 ref를 null→요소로 계속 다시 호출한다. 그 안에서 상태를 바꾸면 갱신이 끝없이 이어진다.

## 해결 1
- `Modal`이 자기 요소를 `ModalContainerContext`로 알려 주고, `SelectContent`가 있으면 그 안에 그린다(안정적인 `useCallback` ref).
- 배경 클릭은 클릭 **위치가 대화상자 영역 밖**일 때만 닫는다.

## 증상 2 — org-db 테스트의 간헐 실패
- `재무팀을 영업본부 아래로 옮기면 자금파트까지 depth가 함께 바뀐다`가 전체 실행 중 약 4번에 1번 실패했다. 값을 보니 받은 `path`의 부서 id들이 기대한 id들과 전부 달랐다.

## 원인 2
- 같은 트랜잭션에서 `select * from department`를 사업자 필터 없이 읽고 `code`로 `find`했다. 다른 테스트(CSV 가져오기)가 물류 사업자에 같은 코드(`CASH`)의 부서를 복제해 두어서, 어느 행이 먼저 잡히느냐가 **DB 행 순서**에 달렸다. 다른 테스트가 `department`를 UPDATE할 때마다 행 순서가 바뀌어 가끔 엉뚱한 부서가 잡혔다.

## 해결 2
- 본사 사업자 부서만 보도록 필터했다. 이후 전체 통합 테스트를 6번 연속 돌려 모두 통과했다.

## 재발 방지 규칙
- 모달(`<dialog>`) 안에 팝오버·드롭다운을 넣을 때는 **실제 마우스로** 열어 본다. 프로그램 `.click()`과 Playwright의 `locator.click()`은 mousedown·mouseup 대상이 같아 이 결함을 재현하지 못할 수 있으므로, 새 모달 흐름은 개발 서버에서 직접 눌러 확인한다.
- 배경 클릭 닫기처럼 `e.target === 요소 자신`으로 판정하는 코드는 클릭 위치(영역)도 함께 확인한다.
- React `ref`에 인라인 함수를 쓰지 않는다(상태를 바꾸는 ref는 특히).
- 테스트에서 테넌트 안의 모든 행을 읽고 `find`로 코드를 찾을 때는 사업자 등 범위로 먼저 거른다. 다른 테스트가 같은 코드의 행을 만들 수 있다고 가정한다.
- 간헐 실패는 "다시 돌리니 통과"로 넘기지 말고 단언을 구체적인 값(`toBe(기대 문자열)`)으로 바꿔 실패 때 실제 값을 남긴 뒤 원인을 찾는다.

## 재발 기록

---
title: 작성 표의 숨김 머리글이 스크롤 영역 밖으로 넘침
date: 2026-11-02
status: resolved
tags: [ui, forms, accessibility, playwright, test]
related: [docs/plan/2026-10-30-form-block-editor.md, features/approval/src/ui/components/form-fields.tsx]
---

## 증상

13종 필드·2열·4개 데이터 열 표가 있는 작성 화면을 1280px에서 360px로 바꾸면, 본문 카드의 일반 div는 모두 화면 안인데 `documentElement.scrollWidth`가 587px이었다. 열·표의 스크롤 컨테이너 자체 폭은 화면 안이었다.

## 원인 확인

- 먼저 일반 div만 조사해 원인을 놓쳤다. 모든 태그와 shadow root의 실제 rect·position을 수집했다.
- 표의 마지막 머리글에 있는 `span.sr-only`(“행 삭제”)의 `position:absolute`, `right:587`, 폭1px을 확인했다. 표는 내부 스크롤 영역에서 정상적으로 넓었지만, 숨김 span은 위치 기준 조상이 스크롤 영역 밖에 있어 페이지 overflow를 만들었다.
- Select 포털을 닫고 DOM 제거까지 기다려도 같은 587px이었다. Next 개발 도구 shadow root에는 화면을 넘는 요소가 없었다. 포털 종료 애니메이션이나 개발 도구를 원인으로 확정하지 않는다.

## 해결

- 작성 표의 실제 `overflow-x-auto` wrapper에 `relative`를 지정해 숨김 절대 위치 요소의 기준을 스크롤 안으로 옮긴다.
- 공통 columns 스크롤에도 `position:relative`를 둬 열 안의 숨김 폼 컨트롤이 같은 문제를 만들지 않게 한다.
- 전역 overflow 숨김, sr-only 제거, 접근성 이름 삭제, 모바일 허용 폭 증가는 하지 않는다.
- E2E의 페이지 폭 `<=360` 단언과 columns·표 자체가 내부에서 스크롤되는 단언을 함께 유지한다. 최종 재실행 결과는 카드·PR의 증거를 따른다.

## 함께 확인한 시험 문제

- 필수 별표가 있는 라벨의 `getByLabel(..., exact:true)`는 실패했지만 접근성 스냅샷의 textbox 이름·입력값은 정상이었다. 컨트롤은 `getByRole("textbox", {name, exact:true})`로 찾고 기대값을 유지한다.
- 양식 버전 공개 API는 `{version: {...}}`를 받는다. fixture의 평면 version payload가 거부되면 앱 검증을 느슨하게 하지 말고 기존 API 계약에 맞게 fixture를 고친다.
- 기존 S3 UI 흐름의 총30초 timeout은 본문 로딩 중이었다. 기존 실패로 단정하거나 timeout을 늘리지 않고 실패한 두 흐름만 같은 격리 러너에서 재실행했다. 기존 S3 흐름은 통과했으며 최종 전체 실행 결과를 별도로 남긴다.

## 재발 방지 규칙

- 내부 스크롤 wrapper에 절대 위치 자식(sr-only 포함)이 있으면 그 wrapper를 위치 기준으로 만든다.
- 가로 넘침은 컨테이너 폭뿐 아니라 숨김 컨트롤·절대 위치 요소의 rect와 containing block까지 조사한다. 일반 div만 조사해서 원인이 없다고 결론내리지 않는다.
- 모바일 E2E에서 페이지 넘침과 의도한 내부 스크롤을 별도로 단언한다. 오류를 숨기는 전역 `overflow-x:hidden`으로 대신하지 않는다.

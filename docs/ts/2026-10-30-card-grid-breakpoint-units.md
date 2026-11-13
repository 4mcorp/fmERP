---
title: 1920px 이상 카드 그리드가 4열에 머무는 Tailwind breakpoint 단위 혼용
date: 2026-10-30
status: resolved
tags: [ui, tailwind, responsive, test]
related: [docs/plan/2026-10-15-ui-ux-refactor-round2.md, shared/src/ui/card-grid.tsx, apps/web/e2e/print-preview.spec.ts]
---

## 증상

U10 재검증에서 1920px·2560px의 결재 상세 카드 그리드가 요구된 5열이 아니라 4열이었다. 기준 dev `626a70e`의 실제 Chromium computed style은 각각 `392px 392px 392px 392px`, `552px 552px 552px 552px`였다.

## 원인

`md`·`xl`·`2xl`은 rem 기준인데 마지막 breakpoint만 `min-[1920px]`였다. Tailwind의 breakpoint 정렬에서 서로 다른 단위를 섞어 5열 규칙이 뒤의 `2xl:grid-cols-4`에 덮였다. 기존 단위 시험은 클래스 문자열의 존재만 확인하여 실제 CSS 우선순위 문제를 발견하지 못했다.

## 해결

마지막 breakpoint를 같은 단위인 `min-[120rem]`으로 바꾼다. 기본 16px 루트에서 1920px이다. 클래스 단위 시험을 맞추고, 결재 상세 실제 브라우저 E2E에서 360·1280·1536·1919·1920·2560px의 열 수를 1·3·4·4·5·5로 확인한다. `CardGrid.Full`은 모든 폭에서 그리드 전체 너비를 유지하는지도 확인한다.

참조·수신·공람 카드의 제목은 설명 텍스트에 밀려 360px에서 여러 줄로 바뀌었다. 제목의 축소·자동 개행을 막아 한 줄을 유지하고 설명의 기존 말줄임을 유지한다. 회귀 E2E는 카드 제목의 실제 높이가 line-height 한 줄 이내인지 확인하고 토글을 열고 닫는다.

## 함께 확인한 관리 화면 정렬

같은 U10 캡처에서 조직 관리의 주 동작이 CSV 보조 동작보다 왼쪽에 있었고, 모바일 CSV 가져오기가 내보내기와 다른 줄에 있었다. 직위·직책의 추가 버튼도 폼 오른쪽 끝에 정렬되지 않았다. 기존 `ActionBar`로 묶어 주 동작을 마지막에 두고, 360px·1280px 실제 브라우저에서 버튼 오른쪽 경계 및 CSV 두 버튼의 y 좌표를 확인한다. 등록·가져오기 API 동작은 바꾸지 않는다.

## 재발 방지 규칙

- Tailwind responsive breakpoint는 기본 breakpoint와 같은 단위를 사용한다.
- 클래스 문자열 시험만으로 반응형 배치를 통과 처리하지 않는다. 생성된 CSS가 적용된 브라우저에서 경계 전후의 computed style과 전체 폭 카드를 확인한다.
- U10의 15칸 문서 검증은 계정 한도로 미검증이며 이 수정의 5열 검증과 혼동하지 않는다.

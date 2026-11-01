---
title: Tiptap 블록 편집기의 초기 참조·드래그 좌표·초안 캐시 검증
date: 2026-11-02
status: resolved
tags: [ui, tiptap, test, playwright, deps]
related: [docs/plan/2026-10-30-form-block-editor.md, features/approval/src/ui/components/form-block-editor.tsx]
---

## 증상과 원인

- `useEditor({ immediatelyRender: false })`의 첫 렌더에서는 editor가 null이다. 한 번 등록한 Suggestion 플러그인이 첫 렌더의 삽입 함수를 캡처하면 메뉴만 열리고 블록은 삽입되지 않는다.
- toolbar의 `insertContent`는 초기 NodeSelection을 대체하므로 첫 필드가 사라졌다. 추가 명령은 선택을 덮어쓰지 않고 선택 뒤에 삽입해야 한다.
- Tiptap 3.31.4의 React NodeView 조합에서 기본 드래그 좌표가 원점 또는 이전 데스크톱 위치에 남았다. 실제 필드의 client rect는 정상인데 핸들은 `x=-23.67,y=0`이었다. 전역 DOM/CSS를 고치거나 패키지 버전을 올리지 않았다. 하위 라이브러리 내부 원인은 확정하지 않는다.
- React Query에 남은 최초 GET 초안이 null이면 같은 SPA에서 다시 들어올 때 revision 0을 재사용할 수 있다. 공개 버전의 refetch와 초안 revision은 다른 상태다.
- 개발 서버의 HMR WebSocket이 열린 채로 남아 `networkidle`이 끝나지 않았다. trace의 해당 요청은 101이었고, 웹폰트 요청은 200으로 끝났다. 신규 편집기 마운트는 hydration과 권한 로드 뒤에 끝나므로 그 DOM을 준비 조건으로 쓴다.
- 블록 E2E fixture가 양식 목록의 페이지 수를 늘려 기존 `지출결의서`가 첫 페이지에서 사라졌다. 검색 후 같은 행을 단언하도록 시험을 고쳤다. 반복 로컬 실행에서 초기화하지 않은 DB 때문에 승인 흐름도 한 번 실패했다. 이를 기존 앱 실패로 분류하지 않고 전용 테스트 DB를 다시 초기화한 실행으로 대조했다.

## 해결

- 명령이 editorRef의 현재 인스턴스를 사용한다. toolbar 추가는 선택 뒤의 빈 범위에, 슬래시는 검색 범위에 `insertContentAt`을 적용한다.
- 드래그 기준은 `editor.view.nodeDOM(pos)`다. 핸들 설정 객체는 상수이며 fixed viewport 좌표를 명시하는 middleware를 사용한다. 모바일에서는 포털 핸들을 숨겨 페이지 넘침을 막고 필드 설정의 위/아래 버튼을 제공한다. 실제 Chrome mouse drag로 이동 후 저장된 키 순서를 확인했다.
- 초안은 재진입마다 항상 조회하고 초기 조회가 끝날 때까지 편집기를 열지 않는다. 응답 revision으로 PUT을 직렬화하며 공개 후에도 revision을 리셋하지 않는다. 충돌은 자동 재시도하지 않는다. 사본 복사·다시 불러오기, 일반 실패의 명시적 재시도, 미저장 이동 경고를 제공한다.
- 수정 전 상태로 되돌린 초안은 요청 없이 저장 완료 상태로 돌아간다. 이 경로와 저장 중 추가 입력·네트워크 실패·409는 저장 세션 단위 시험으로 확인한다.
- 로컬 화면 시험은 테스트 DB(55433)만 사용하고 잠금을 잡았다. 개발/운영 DB는 변경하지 않았다. mac13은 Chrome 채널, Linux/CI는 기존 Chromium을 사용한다. 임시 실행 설정은 최종 diff에서 제거한다.

- 반환값을 직접 검사하던 기존 admin-form-edit 단위 시험 3건은 keyed 자식 경계를 실행하지 않아 실패했다. 실제 자식까지 실행하는 시험 adapter를 추가하고 기존 LoadingState·QueryErrorState·refetch 횟수·신규 form 반환 단언을 모두 유지했다. 초안 조회 실패의 독립 재시도도 추가했다.
- 짧은 문서의 페이지 가이드 수를 ceil로 계산하면 경계 직전 소수 픽셀 때문에 불필요한 2쪽 선이 설정 영역까지 나타났다. floor+1px 오차 허용과 가이드 영역 clipping을 사용하고, 첫 선의 위치가 문서 크롬 시작부터 266mm인지 E2E로 검사한다.
- 비어 있는 열의 저장 모델은 빈 배열이어도 편집 중에는 슬래시를 입력할 빈 문단이 필요하다. 본문·각 열 끝에 입력용 문단을 붙이고 직렬화할 때 한 개만 제외한다. 빈 열 왕복 회귀 시험과 새로 연 열 안 삽입 시험을 남긴다.

## 재발 방지 규칙

- 비동기 초기화된 editor를 플러그인 closure로 고정하지 않는다. 같은 버전의 실제 브라우저에서 메뉴 클릭 후 저장 모델을 확인한다.
- 블록 추가와 선택 대체를 구분한다. 기존 필드 키의 잔존과 추가 뒤 순서를 시험한다.
- 드래그 위치는 실제 NodeView rect와 비교한다. viewport 변경 뒤 document.scrollWidth도 확인한다. 패키지 업데이트·전역 overflow 숨김으로 문제를 가리지 않는다.
- 초안 캐시와 편집 세션 revision을 분리한다. SPA 이탈·재진입 후 다시 저장하는 E2E를 남긴다.
- networkidle timeout은 trace로 미완료 요청을 확인하고, hydration 뒤 실제 편집기 DOM을 기다린다. 입력값 단언은 그대로 유지한다.
- 상태를 바꾸는 E2E의 최종 판정은 새로 초기화한 전용 DB에서 한다. 재사용 DB 실패를 코드 회귀나 기존 실패로 추측하지 않는다.
- 공급망 collector는 pnpm lockfile을 해석하지 못하므로 최신 버전 결과를 설치 버전 결과로 인용하지 않는다. 실제 설치된 9개 패키지의 정확 버전으로 스크래치 manifest를 만들어 다시 수집하고, 전체 lockfile은 pnpm audit로 별도 검사한다.

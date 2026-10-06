---
name: feature-map
description: 코드를 훑기 전에 기능 지도(feature map)로 수정 대상을 찾는다. "알림 읽음 버튼", "결재 반려 화면", "이 파일을 고치면 어디에 영향?"처럼 4mERP에서 어느 기능·화면·API·표·시험을 고칠지 정해야 할 때 먼저 쓴다.
allowed-tools: Bash Read Grep
---

# 기능 지도로 수정 대상 찾기

4mERP는 기능별 폴더(`features/<기능>/`) 구조다. 파일을 이것저것 열어 보기 전에 **생성된 기능 지도**로 범위를 좁힌다.

1. **찾기:** `pnpm feature:find "<찾는 말>"` — 한국어 낱말 몇 개면 된다. 기능, 접근 경로, 화면 파일, API, 소유 표, 시험 위치가 한 번에 나온다.
2. **압축본:** `docs/feature-map/INDEX.md`(기능당 5줄)는 이미 CLAUDE.md로 컨텍스트에 있다. 전체 사실(라우트 목록 등)은 `docs/feature-map/index.json`.
3. **영향:** 파일을 고치기 전 `pnpm feature:impact <파일…>` — 그 파일이 속한 기능, 진입점 여부, 그 기능의 앱 어댑터(`apps/web/app/...`)를 알려 준다.
4. **고친 뒤:** 화면·라우트·표 접근을 바꿨으면 해당 `features/<기능>/feature.map.yaml`(의도: `summary`·`keywords`·`access`·`screens`·`tables.reads`)을 맞추고 `pnpm feature:index`를 실행해 색인을 갱신한다. `pnpm arch:check`의 `feature-map` 게이트가 지도와 코드가 어긋나면 실패시킨다.

## 규칙
- 기능은 다른 기능을 import하지 않는다. 필요하면 `shared`로 올리거나 계약+주입(`shared/contracts`, provisioning, 슬롯)으로 푼다 — 먼저 `docs/plan/2026-10-06-feature-architecture-refactor.md` 12장의 "결합을 푼 방법"을 본다.
- 다른 기능의 표를 읽으려면 그 기능이 아니라 **읽는 쪽** 지도의 `tables.reads`에 선언한다. 쓰기 예외는 `tables.writes`에 이유와 함께(`pnpm arch:check`의 `table-ownership`).
- 결과가 없으면 낱말을 바꿔 다시 찾거나 `docs/feature-map/INDEX.md`를 읽는다. 그래도 없으면 그때 검색(Grep)한다.

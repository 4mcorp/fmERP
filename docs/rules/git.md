# Git 규칙

스킬: **`git-commit`** (변경 내용을 분석해 Conventional Commits 형식으로 커밋)

## 1. 커밋 메시지
- 형식: `<type>(<scope>): <한국어 설명>` — 예: `feat(approval): 병렬 합의 완료 조건 추가`
- type: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- scope: `approval`, `org`, `auth`, `audit`, `storage`, `backup`, `notify`, `admin`, `db`, `ui`, `worker`, `infra`, `shared`, `deps`, `docs`, `claude` (해당 없으면 생략)
- 설명은 72자 이내로 쓴다. 본문에는 "왜" 바꿨는지 적고, 관련 PRD ID(예: APV-061)와 ts·plan 파일이 있으면 적는다.
- 하나의 논리적 변경 = 하나의 커밋.

## 2. 안전 규칙
- 커밋·푸시는 **사용자가 요청할 때만** 한다.
- `--no-verify`, force push, `reset --hard`는 쓰지 않는다. 사용자가 명시적으로 요청한 경우만 예외다.
- 대화형 명령(`git add -p`, `rebase -i`)은 이 환경에서 동작하지 않으므로 쓰지 않는다.
- 커밋 전에 스테이징된 파일에 비밀정보(`.env`, 키, 덤프)가 없는지 확인한다.

## 3. 브랜치
현재(설계 단계)는 `main`에 직접 커밋한다. 구현을 시작하면 브랜치·PR 전략을 정해 이 섹션을 갱신한다.

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

## 3. 브랜치·PR·병합 (정적 강제)
규칙의 정의와 적용 방법은 `.github/rulesets/README.md`, 서버 강제는 `.github/rulesets/*.json`(ruleset), 임시·보조 강제는 lefthook `git-policy`와 CI `policy` 잡이다.
- main에는 직접 push·force push·삭제를 하지 않는다. 모든 변경은 PR로 들어간다.
- 작업 브랜치는 항상 최신 `origin/main`에서 분기하고, 이름은 `wt|feat|fix|chore|docs|refactor|test|ci|perf|build/<소문자-숫자-._->`로 한다. 브랜치끼리 쌓지 않는다(선행 작업은 PR을 main에 병합한 뒤 후속 카드를 시작한다).
- PR 제목은 Conventional Commits 형식이다. 병합은 squash만 허용하고, 병합 후 브랜치는 자동 삭제된다.
- 병합 조건: CI `check`·`policy` 통과, 최신 main 기준(up-to-date), 코드오너 승인 1건, 리뷰 대화 모두 해결.
- 충돌 시: 해당 브랜치에서 `git fetch origin && git rebase origin/main` 후 `git push --force-with-lease`. 다른 브랜치 force push는 하지 않는다.

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

## 3. 브랜치 전략 (main / dev, 정적 강제)
규칙의 정의와 적용 방법은 `.github/rulesets/README.md`, 서버 강제는 `.github/rulesets/*.json`(ruleset), 보조 강제는 lefthook `git-policy`, CI `policy` 잡, `automerge-dev` 워크플로다.

```
작업 브랜치 --PR(자동병합, squash)--> dev --PR(사람 검증 후 병합, merge commit)--> main --> 릴리즈·배포
```
- **모든 작업 브랜치는 최신 `origin/dev`에서 분기**하고 `dev`로 PR을 만든다. 이름은 `wt|feat|fix|chore|docs|refactor|test|ci|perf|build/<소문자-숫자-._->`. 브랜치끼리 쌓지 않는다.
- `main`·`dev`에는 직접 push·force push·삭제를 하지 않는다.
- **dev 병합은 자동이다.** `check`·`policy`가 통과하고 충돌이 없으면 `automerge-dev`가 squash 병합하고 브랜치를 지운다. 보호 경로(CODEOWNERS) 변경, draft PR, `no-automerge` 라벨은 자동병합하지 않고 사람이 병합한다.
- **main 병합은 사람이 한다.** `dev`→`main` PR(제목 `release: vX.Y.Z`)만 허용되고(`policy` 잡이 head가 dev가 아니면 실패), 사람이 검증한 뒤 **merge commit**으로 병합한다. 자동병합 대상이 아니며 에이전트는 main PR을 만들거나 병합하지 않는다.
- PR 제목은 Conventional Commits 형식이다(release PR 제외). dev 병합은 squash만, 병합 후 브랜치는 자동 삭제된다.
- 충돌 시: 해당 브랜치에서 `git fetch origin && git rebase origin/dev` 후 `git push --force-with-lease`. 다른 브랜치 force push는 하지 않는다.
- 배포는 main 병합 후 `docs/DEPLOYMENT_PLAN.md` 9.4 절차를 따른다.

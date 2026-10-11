# Git ruleset

`main.json`(릴리즈 브랜치, 사람 검증), `dev.json`(통합 브랜치, 자동병합)은 GitHub ruleset 정의다. 구조는 `docs/rules/git.md` 3절.
저장소가 **Free 플랜 비공개**이면 ruleset·브랜치 보호 API가 403이라 적용할 수 없다. GitHub Pro로 올리거나 공개 저장소로 바꾼 뒤 한 번 적용한다.

```
gh api -X POST repos/dyoun12/fmERP/rulesets --input .github/rulesets/main.json
gh api -X POST repos/dyoun12/fmERP/rulesets --input .github/rulesets/dev.json
```

적용 전까지는 아래 수단이 같은 규칙을 대신 강제한다.

| 규칙 | 지금(Free) | ruleset 적용 후 |
|---|---|---|
| main·dev 직접 push·force push·삭제 | lefthook `git-policy`(로컬 pre-push) | 서버가 거부 |
| 작업 브랜치 이름 | lefthook `git-policy` + CI `policy` 잡 | 서버가 거부 |
| PR 제목(Conventional Commits) | CI `policy` 잡 | (ruleset metadata 규칙은 개인 저장소 미지원) |
| 충돌·최신 아님·merge 커밋 | CI `policy` 잡(실패 처리) | strict status check + linear history |
| 병합 방식 | 저장소 설정: squash만 허용 | allowed_merge_methods |
| 병합 후 브랜치 | 저장소 설정: 자동 삭제 | - |

로컬 훅은 `--no-verify`로 우회되므로, 서버 강제는 ruleset 적용 후에야 완성된다.

## 충돌이 났을 때
1. CI `policy` 잡이 실패하고 `충돌 파일` 목록을 출력한다. 충돌 PR은 병합되지 않는다.
2. 해당 카드의 코더가 자기 브랜치에서 `git fetch origin && git rebase origin/dev`을 실행한다.
3. 충돌을 풀고 `git push --force-with-lease`로 올린다. 이 브랜치만 바뀌므로 다른 PR에는 영향이 없다.
4. 스택(다른 브랜치 위에 쌓인) 브랜치라면 `git rebase --onto origin/dev <옛 부모 tip>`을 쓴다.
5. 같은 PR에서 충돌 해결이 2회 실패하거나 CODEOWNERS 보호 파일이 충돌하면 코더가 `kanban_block`으로 사람에게 넘긴다.

## 선행 설정 (ruleset 적용 전 한 번)
1. `dev` 브랜치를 `main`에서 만들어 push한다(첫 생성만 예외라 `gh api`로 ref를 만든다).
2. 저장소 기본 브랜치를 `dev`로 바꾼다(`gh api -X PATCH repos/dyoun12/fmERP -f default_branch=dev`). 에이전트 worktree와 `~DEFAULT_BRANCH` 규칙이 dev를 기준으로 동작한다.
3. `main.json`의 bypass(관리자, PR 경유만)는 1인 운영에서 본인 PR을 승인할 수 없어서 둔다. 팀이 늘면 제거한다.
4. GitHub 자체 auto-merge는 Free 비공개 저장소에서 켜지지 않아 `automerge-dev` 워크플로가 대신한다. 기본 `GITHUB_TOKEN`으로 병합하면 후속 `push` 워크플로가 돌지 않으므로, 필요하면 저장소 시크릿 `AUTOMERGE_TOKEN`(PAT)을 등록한다.
5. main 병합은 자동화하지 않는다. 배포 트리거는 main push 이후 단계에서만 건다.

## 적용 현황·제약
- 적용됨: `main-protection`, `dev-protection` (public 전환 후 적용).
- 브랜치 이름(`branch_name_pattern`)·커밋 메시지(`commit_message_pattern`) ruleset 규칙은 개인 소유 저장소에서 422로 거부된다(조직/Enterprise 전용). 대신 로컬 `git-policy` 훅(브랜치 이름), CI `policy` 잡(PR 제목), commitlint가 강제한다. 조직으로 이전하면 ruleset으로 올릴 수 있다.

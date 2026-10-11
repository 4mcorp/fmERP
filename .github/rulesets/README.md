# Git ruleset

`main.json`(기본 브랜치 보호)과 `branch-names.json`(작업 브랜치 이름)은 GitHub ruleset 정의다.
저장소가 **Free 플랜 비공개**이면 ruleset·브랜치 보호 API가 403이라 적용할 수 없다. GitHub Pro로 올리거나 공개 저장소로 바꾼 뒤 한 번 적용한다.

```
gh api -X POST repos/dyoun12/fmERP/rulesets --input .github/rulesets/main.json
gh api -X POST repos/dyoun12/fmERP/rulesets --input .github/rulesets/branch-names.json
```

적용 전까지는 아래 수단이 같은 규칙을 대신 강제한다.

| 규칙 | 지금(Free) | ruleset 적용 후 |
|---|---|---|
| main 직접 push·force push·삭제 | lefthook `git-policy`(로컬 pre-push) | 서버가 거부 |
| 작업 브랜치 이름 | lefthook `git-policy` + CI `policy` 잡 | 서버가 거부 |
| PR 제목(Conventional Commits) | CI `policy` 잡 | commit_message_pattern |
| 충돌·최신 아님·merge 커밋 | CI `policy` 잡(실패 처리) | strict status check + linear history |
| 병합 방식 | 저장소 설정: squash만 허용 | allowed_merge_methods |
| 병합 후 브랜치 | 저장소 설정: 자동 삭제 | - |

로컬 훅은 `--no-verify`로 우회되므로, 서버 강제는 ruleset 적용 후에야 완성된다.

## 충돌이 났을 때
1. CI `policy` 잡이 실패하고 `충돌 파일` 목록을 출력한다. 충돌 PR은 병합되지 않는다.
2. 해당 카드의 코더가 자기 브랜치에서 `git fetch origin && git rebase origin/main`을 실행한다.
3. 충돌을 풀고 `git push --force-with-lease`로 올린다. 이 브랜치만 바뀌므로 다른 PR에는 영향이 없다.
4. 스택(다른 브랜치 위에 쌓인) 브랜치라면 `git rebase --onto origin/main <옛 부모 tip>`을 쓴다.
5. 같은 PR에서 충돌 해결이 2회 실패하거나 CODEOWNERS 보호 파일이 충돌하면 코더가 `kanban_block`으로 사람에게 넘긴다.

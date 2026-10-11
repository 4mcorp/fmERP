// pre-push 정책: main 직접 push·삭제 차단, 작업 브랜치 이름 검사 (docs/rules/git.md)
// lefthook가 git의 pre-push stdin("<local ref> <local sha> <remote ref> <remote sha>")을 넘긴다.
import { readFileSync } from "node:fs";

const BRANCH_RE = /^(wt|feat|fix|chore|docs|refactor|test|ci|perf|build)\/[a-z0-9._-]+$/;
const ZERO = /^0+$/;
const errors = [];

const lines = readFileSync(0, "utf8").split("\n").filter(Boolean);
for (const line of lines) {
  const [, localSha, remoteRef] = line.split(" ");
  if (!remoteRef?.startsWith("refs/heads/")) continue;
  const name = remoteRef.slice("refs/heads/".length);

  if (name === "main") {
    errors.push("main에는 직접 push할 수 없다. 작업 브랜치로 PR을 만든다.");
    continue;
  }
  if (ZERO.test(localSha)) continue; // 브랜치 삭제는 허용
  if (!BRANCH_RE.test(name)) {
    errors.push(`브랜치 이름 '${name}'이(가) 규칙에 맞지 않는다: ${BRANCH_RE}`);
  }
}

if (errors.length) {
  console.error(`\n[git-policy] push 거부:\n - ${errors.join("\n - ")}\n`);
  process.exit(1);
}

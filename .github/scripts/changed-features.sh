#!/usr/bin/env bash
# 변경 파일 위치로 CI 테스트 범위를 정한다. 결과는 $GITHUB_OUTPUT(없으면 stdout)에 쓴다.
#   features : 단위 테스트할 기능 JSON 배열. 전체 실행이면 단위 테스트가 있는 모든 기능
#   core     : 기능 밖 단위 테스트 + 전체 통합 테스트를 돌릴지
# 규칙 (보수적: 모르면 전부 돌린다)
#   - PR이 아니거나(push), main 대상이거나, 비교 기준을 못 구하면 → full
#   - features/<이름>/ 아래 파일만 바뀌면 → 그 기능만
#   - docs/, *.md, apps/web/e2e/, CODEOWNERS, rulesets, e2e·policy·automerge 워크플로만 바뀌면 → 테스트 생략
#   - 그 밖(shared, packages, apps, tools, 락파일, 루트 설정, ci.yml 등)은 여러 기능이 공유하므로 → full
set -euo pipefail

shopt -s nullglob globstar
out="${GITHUB_OUTPUT:-/dev/stdout}"
all=()
for dir in features/*/; do
  name=${dir#features/}; name=${name%/}
  [[ "$name" =~ ^[a-z][a-z0-9-]*$ ]] || { echo "잘못된 기능 이름: $name" >&2; exit 1; }
  tests=("${dir}"src/**/*.test.ts "${dir}"tests/**/*.test.ts)
  for test in "${tests[@]}"; do
    if [[ "$test" != *.int.test.ts ]]; then all+=("$name"); break; fi
  done
done
emit() { # $1=core, $2..=기능 이름들
  local core=$1; shift
  local json="[" sep=""
  for n in "$@"; do json="$json$sep\"$n\""; sep=","; done
  echo "core=$core" >>"$out"
  echo "features=$json]" >>"$out"
  echo "범위: core=$core features=$json]" >&2
}

if [ "${EVENT_NAME:-}" != pull_request ] || [ "${BASE_REF:-}" != dev ]; then
  emit true "${all[@]}"; exit 0
fi
# 이벤트 base SHA 우선: 실행 중 이동하는 dev ref의 영향을 피한다.
base=${BASE_SHA:-origin/dev}
# NUL 구분 + no-renames: 줄바꿈 파일명과 이동 전/후 양쪽 기능을 보존한다.
diff_file=$(mktemp)
trap 'rm -f "$diff_file"' EXIT
if ! git diff --no-renames --name-only -z "$base...HEAD" -- >"$diff_file"; then
  echo "diff 실패 → 전체 실행" >&2
  emit true "${all[@]}"; exit 0
fi
full=false; core=false
declare -A picked=()
while IFS= read -r -d '' file; do
  case "$file" in
    features/*/*)
      core=true
      name=${file#features/}; name=${name%%/*}
      if [ -d "features/$name" ]; then picked["$name"]=1; else full=true; fi
      ;;
    docs/*|*.md|apps/web/e2e/*|.github/CODEOWNERS|.github/rulesets/*|.github/workflows/e2e.yml|.github/workflows/policy.yml|.github/workflows/automerge-dev.yml) ;;
    *) full=true ;;
  esac
done <"$diff_file"
if [ "$full" = true ]; then emit true "${all[@]}"; exit 0; fi
selected=()
for name in "${all[@]}"; do
  [ -z "${picked[$name]:-}" ] || selected+=("$name")
done
# 테스트가 없는 기능(home 등)도 core 통합은 반드시 실행한다.
emit "$core" "${selected[@]}"

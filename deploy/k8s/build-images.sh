#!/bin/sh
# colima docker 에 이미지를 직접 빌드한다 (k3s 가 같은 docker 런타임을 쓰므로 레지스트리가 필요 없다. DEPLOYMENT_PLAN 9.4)
# 사용: deploy/k8s/build-images.sh <dev|prod>
# 환경별 기준 브랜치: dev → origin/dev, prod → origin/main.
# 작업 트리가 아니라 해당 브랜치의 최신 커밋(git archive)을 빌드하므로 체크아웃 상태와 무관하다.
set -e
ENV=${1:?usage: build-images.sh dev|prod}
case "$ENV" in
  dev)  REF=origin/dev ;;
  prod) REF=origin/main ;;
  *) echo "환경은 dev 또는 prod 이다: $ENV" >&2; exit 2 ;;
esac
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
git -C "$ROOT" fetch origin "${REF#origin/}"
SHA=$(git -C "$ROOT" rev-parse "$REF")
SRC=$(mktemp -d "${TMPDIR:-/tmp}/fmerp-build.XXXXXX")
trap 'rm -rf "$SRC"' EXIT
git -C "$ROOT" archive "$REF" | tar -x -C "$SRC"
echo "빌드: $ENV ← $REF ($SHA)"
cd "$SRC"
docker build -f apps/web/Dockerfile --target runner  -t fmerp-web:$ENV --label "fmerp.git-sha=$SHA" .
docker build -f apps/web/Dockerfile --target builder -t fmerp-web-builder:$ENV --label "fmerp.git-sha=$SHA" .
docker build -f apps/worker/Dockerfile               -t fmerp-worker:$ENV --label "fmerp.git-sha=$SHA" .

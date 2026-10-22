#!/bin/sh
# k3s test 네임스페이스에 테스트 Job 을 동적으로 만들어 실행하고, 로그를 따라간 뒤 종료코드를 돌려준다.
# 사용: deploy/k8s/test/run-tests.sh [-w <worktree 절대경로>] [-t <초>] <명령...>
#   예) run-tests.sh pnpm test:unit        run-tests.sh pnpm test:int        run-tests.sh pnpm test:e2e
# 전제: ~/SW 가 colima 에 마운트되어 있고, fmerp-worker:dev 이미지가 있다 (deploy/k8s/build-images.sh dev). Job 은 10분 뒤 자동 삭제된다.
set -e
WT=$(cd "$(dirname "$0")/../../.." && pwd); TIMEOUT=1800
while getopts w:t: o; do case $o in w) WT=$OPTARG;; t) TIMEOUT=$OPTARG;; esac; done; shift $((OPTIND-1))
[ $# -gt 0 ] || { echo "usage: run-tests.sh [-w worktree] [-t sec] <command...>" >&2; exit 2; }
export WORKTREE=$WT TIMEOUT TEST_CMD="$*"
NAME=$(envsubst '${WORKTREE} ${TIMEOUT} ${TEST_CMD}' < "$(dirname "$0")/job.tmpl.yaml" | kubectl create -f - -o name)
echo "job: $NAME"; JOB=${NAME#*/}
kubectl -n test wait pod -l job-name=$JOB --for=condition=Ready=false --timeout=1s >/dev/null 2>&1 || true
until kubectl -n test logs job/$JOB -c runner --follow 2>/dev/null; do sleep 3; done
for i in $(seq 60); do
  S=$(kubectl -n test get job $JOB -o jsonpath='{.status.conditions[*].type}')
  case "$S" in *Complete*) echo "== PASS"; exit 0;; *Failed*) echo "== FAIL"; exit 1;; esac; sleep 2
done
echo "== UNKNOWN"; exit 1

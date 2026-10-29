#!/bin/sh
# dev 네임스페이스의 개발 의존성을 compose 때와 같은 호스트 포트(127.0.0.1)로 연다. 종료: Ctrl-C
set -e
trap 'kill 0' INT TERM EXIT
kubectl -n dev port-forward svc/postgres      55432:5432 &
kubectl -n dev port-forward svc/postgres-test 55433:5432 &
kubectl -n dev port-forward svc/s3            58333:8333 &
kubectl -n dev port-forward svc/mailpit       58025:8025 51025:1025 &
wait

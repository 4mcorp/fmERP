#!/bin/sh
# colima docker 에 이미지를 직접 빌드한다 (k3s 가 같은 docker 런타임을 쓰므로 레지스트리가 필요 없다. DEPLOYMENT_PLAN 9.4)
# 사용: deploy/k8s/build-images.sh <dev|prod>   — 저장소 루트의 현재 체크아웃을 빌드한다
set -e
ENV=${1:?usage: build-images.sh dev|prod}
cd "$(dirname "$0")/../.."
docker build -f apps/web/Dockerfile --target runner  -t fmerp-web:$ENV .
docker build -f apps/web/Dockerfile --target builder -t fmerp-web-builder:$ENV .
docker build -f apps/worker/Dockerfile               -t fmerp-worker:$ENV .

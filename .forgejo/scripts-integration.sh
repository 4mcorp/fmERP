#!/usr/bin/env bash
# job 컨테이너 네트워크를 공유하는 PostgreSQL(55433)·SeaweedFS(58333)를 DinD 데몬에 띄운다.
# 사용: eval "$(bash .forgejo/scripts-integration.sh)"  → DOCKER_HOST 설정 포함
set -eu
if ! command -v docker >/dev/null; then
  curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz | tar -xz --strip-components=1 -C /usr/local/bin docker/docker
fi
gw=$(node -e "const l=require('fs').readFileSync('/proc/net/route','utf8').split('\n').slice(1).find(x=>x.split('\t')[1]==='00000000');const h=l.split('\t')[2];console.log([6,4,2,0].map(i=>parseInt(h.substr(i,2),16)).join('.'))")
export DOCKER_HOST="tcp://$gw:2375"
me=$(hostname)
docker rm -f "ci-pg-$me" "ci-s3-$me" >/dev/null 2>&1 || true
# initdb 스크립트는 DinD 호스트 경로가 아니라 job 컨테이너 파일이므로 cp 로 넣는다
docker create --name "ci-pg-$me" --network "container:$me" --tmpfs /var/lib/postgresql \
  -e PGPORT=55433 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=fmerp postgres:18-bookworm >/dev/null
docker cp docker/postgres/initdb/. "ci-pg-$me:/docker-entrypoint-initdb.d/"
docker start "ci-pg-$me" >/dev/null
docker run -d --name "ci-s3-$me" --network "container:$me" chrislusf/seaweedfs:4.47 server -s3 -s3.port=58333 -dir=/data -ip.bind=0.0.0.0 >/dev/null
for i in $(seq 1 60); do docker exec "ci-pg-$me" pg_isready -p 55433 -U postgres -d fmerp >/dev/null 2>&1 && break; sleep 2; done
docker exec "ci-pg-$me" pg_isready -p 55433 -U postgres -d fmerp >&2
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:58333/ && break; sleep 2; done
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:58333/ || true)
echo "s3 http $code" >&2
if [ "$code" = "000" ]; then docker ps -a --filter "name=ci-s3-$me" --format '{{.Status}}' >&2; docker logs "ci-s3-$me" 2>&1 | tail -20 >&2; exit 1; fi
echo "export DOCKER_HOST=$DOCKER_HOST"

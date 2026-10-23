# k3s(colima) 배포: dev / prod 네임스페이스

> 상태: dev 적용·검증 완료(2026-10-22), prod는 정의만 있고 Flux 동기화가 `suspend`.
> 서비스 정의(이 저장소 `deploy/k8s`)와 클러스터 공통 영역(`~/SW/infra`)을 분리한다.

## 책임 분리
| 위치 | 내용 |
|---|---|
| 이 저장소 `deploy/k8s/base` | postgres(StatefulSet), web, worker, migrate Job, Ingress. 환경 무관 |
| `deploy/k8s/overlays/dev` | 네임스페이스 `dev`, 호스트 `fmerp.dev.localhost`, 설정값, dev 전용 의존성(`deps/`: SeaweedFS S3, Mailpit, 테스트 DB) |
| `deploy/k8s/overlays/prod` | 네임스페이스 `prod`, 호스트·버킷은 `CHANGE-ME` 자리표시자, DB 20Gi·메모리 상향 |
| `docker/postgres/kustomization.yaml` | `initdb/01-roles.sh`를 ConfigMap으로 만든다(원본 1개, 복제 없음) |
| infra `infrastructure/namespaces` | `dev`·`prod`·`ingress` 네임스페이스, ResourceQuota, LimitRange, 기본 NetworkPolicy |
| infra `infrastructure/controllers/traefik` | 공용 인그레스(HelmRelease). k3s 기본 traefik은 colima에서 꺼져 있다 |
| infra `apps/{dev,prod}/fmerp` | Flux `GitRepository`(이 저장소)·`Kustomization` + SOPS 암호화 Secret (`fmerp-db`, `fmerp-app-env`) |

비밀값은 이 저장소(public)에 두지 않는다. infra의 `secrets.sops.yaml`(age 암호화)에만 둔다.

## 이미지
레지스트리 없이 colima docker에서 직접 빌드한다(k3s가 같은 docker 런타임 사용, DEPLOYMENT_PLAN 9.4).
```
deploy/k8s/build-images.sh dev     # origin/dev  → fmerp-web:dev, fmerp-web-builder:dev, fmerp-worker:dev
deploy/k8s/build-images.sh prod    # origin/main → fmerp-web:prod, ...
```
환경별 기준 브랜치는 **dev 환경 = `dev` 브랜치, prod 환경 = `main` 브랜치**다. 스크립트가 체크아웃 상태와 무관하게 `origin/<기준>`을 fetch해 `git archive`로 빌드하고, 이미지 라벨 `fmerp.git-sha`에 커밋을 남긴다(`docker inspect fmerp-web:dev --format '{{index .Config.Labels "fmerp.git-sha"}}'`). Flux의 `GitRepository`도 dev용은 `dev`, prod용은 `main`을 본다(infra `apps/{dev,prod}/fmerp/sync.yaml`).
worker 이미지는 Playwright 기반이라 첫 빌드가 약 15분 걸린다.

## dev 적용 순서
1. `kubectl apply -f <(sops -d ~/SW/infra/apps/dev/fmerp/secrets.sops.yaml)`
2. `kubectl apply -k deploy/k8s/overlays/dev` (또는 Flux가 `dev` 브랜치를 동기화)
3. `curl -H 'Host: fmerp.dev.localhost' http://127.0.0.1/api/health` → `{"status":"ok","db":"ok"}`
4. S3 버킷 생성(아래 주의 1). 호스트 접근: `deploy/k8s/dev-forward.sh` (compose 때와 같은 127.0.0.1 포트)

## 주의 (실제로 겪은 것)
1. **dev 버킷은 수동 생성이 필요하다.** `ensure-bucket` CLI는 `localhost` 엔드포인트만 허용해 클러스터 안(`http://s3:8333`)에서는 거부된다. 버킷이 없으면 worker 자동 덤프가 FAILED가 된다. 생성: worker 파드에서 `PUT http://s3:8333/fmerp-dev`. (자동화 후보: 초기화 Job)
2. **서비스 링크 환경변수를 끈다(`enableServiceLinks: false`).** Service 이름이 `s3`라 `S3_PORT=tcp://…`가 주입되어 SeaweedFS가 기동 실패한다.
3. **worker는 `NODE_ENV=production`이면 `BACKUP_DATABASE_URL`·`BACKUP_AGE_RECIPIENTS`가 없을 때 기동하지 않는다.** dev에도 age 공개키가 필요하다. 개인키는 서버 밖(`~/.config/sops/age/fmerp-dev-backup.key`)에 둔다.
4. dev는 운영 모드에서 `/dev-login`을 켜기 위해 `APP_ENV=staging`을 쓴다(`shared/src/server/env.ts`). prod ConfigMap에는 `APP_ENV`·`DEV_TEST_LOGIN`을 두지 않는다.
5. `migrate` Job은 불변이다. 이미지·설정이 바뀌면 삭제 후 재적용하거나 Flux `force`(주석 지정됨)를 쓴다.
6. 파드 보안은 `baseline` 강제, `restricted`는 경고만 한다(web·worker·postgres가 root 실행). 강화는 별도 작업.

## prod 활성화 전 필요한 것
- [ ] 도메인 확정 → overlay의 `erp.CHANGE-ME.example` 교체 (BETTER_AUTH_URL·PUBLIC_BASE_URL·Ingress host)
- [ ] 외부 S3(R2 등) 버킷·`S3_ENDPOINT`·키
- [ ] 백업 age 공개키(개인키는 서버 밖) 및 `~/SW/infra/apps/prod/fmerp/secrets.sops.yaml` 작성
- [ ] cloudflared Tunnel 토큰과 배포 (현재 Ingress는 로컬 HTTP만)
- [ ] 운영 이미지 `build-images.sh prod`, 이후 `apps/prod/fmerp/sync.yaml`의 `suspend: true` 제거
- [ ] 단일 노드·단일 Postgres라 가용성은 compose 때와 같다. 백업·복구 리허설(`docs/ops/migration.md`)을 k8s 환경에서 다시 수행

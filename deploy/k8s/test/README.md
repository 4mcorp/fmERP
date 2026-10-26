# 격리 테스트 실행기 계약

```sh
# Python 3.9+ / kubectl 필요. 호스트 pnpm·브라우저 설치는 불필요하다.
deploy/k8s/test/run-tests.sh -w /absolute/worktree -a /absolute/results -q 900 -t 1800 pnpm test:e2e
# 선택적 VM 내부 전용 캐시. 실제 hostPath 생성은 이 명령을 실행할 때만 발생한다.
deploy/k8s/test/run-tests.sh -c /var/lib/fmerp-e2e-cache pnpm test:unit
# 순수 계약 테스트: 실제 kubectl·설치·DB·S3·브라우저를 실행하지 않는다.
python3 -m unittest discover -s deploy/k8s/test -p 'test_*.py' -v
```

- **코드/구성 분리:** `-w`는 소스만 선택한다. Job 템플릿과 공통 실행 스크립트는 호출한 `run-tests.sh` 옆에서 읽는다. 오래된 worktree의 10Gi 템플릿을 재사용하지 않는다. 시작 시 worktree SHA와 **로컬** `origin/dev` SHA를 표시하며 fetch하지 않는다. summary에는 실행 스크립트/템플릿 SHA-256도 남는다. SHA는 미커밋 변경을 나타내지 않으므로 재현 시 dirty worktree 여부도 별도로 확인한다.
- **기존 격리 유지:** runner 3CPU/6Gi, PostgreSQL/S3 각 1Gi, namespace `test`, DB `127.0.0.1:55433`, S3 `127.0.0.1:58333`. PVC·quota·실제 클러스터 상태는 이 구현 작업에서 변경하지 않는다. VM에 source hostPath가 보여야 하고 `fmerp-worker:dev`에 bash/Node/Corepack/pnpm/tar/psql 및 기존 Chromium이 있어야 한다.
- **권한:** 기본 테스트 이미지의 pwuser UID/GID 1001 계약을 사용한다. 초기화 컨테이너만 root로 실행해 실행 전용 work/artifacts/store/cache 볼륨의 소유권을 설정한다(source·DB·Secret 마운트 없음). 실제 runner는 non-root이며 권한 상승과 capabilities를 차단한다. pnpm shim은 `/work/.runner-bin`에 생성하므로 시스템 디렉터리 쓰기 권한이 필요 없다. 다른 이미지를 지정하면 이 UID 및 도구 호환성을 별도로 확인한다.
- **복사:** tar source 단계에서 모든 `node_modules`, `.next`, `.worktrees`, `.git`, `.env*`, `.npmrc`, 키 파일, 이전 테스트 산출물을 제외한다. 파이프 실패를 삼키지 않는다. 실행 때마다 새 `/work`와 `/pnpm-store`가 필요하다.
- **캐시:** 기본값은 공유 캐시 미사용이다. `-c`를 주면 VM 전용 경로 하위 `test`만 마운트한다. dev/prod와 같은 경로를 지정하지 않는다. 키는 lockfile/workspace 설정 + 실제 OS/CPU/Node/ABI/glibc + 선언된 pnpm 버전이다. 완료된 store snapshot만 공유하고, Job마다 자기 emptyDir store로 복사한 뒤 install한다. 가상 store/node_modules는 절대 공유하지 않는다. 게시 때 mkdir lock + 임시 디렉터리 + atomic rename을 사용하며 경쟁자는 기다리지 않고 게시만 건너뛴다. OOM/SIGKILL 후 임시/lock 디렉터리가 남아도 읽기/설치는 막지 않지만 새 snapshot 게시가 생략될 수 있다. 사용 중인 Job이 없을 때 운영자가 해당 키의 잔재/오래된 키를 정리한다. 자동 GC는 없다. 이 캐시는 신뢰하는 로컬 test 코드만 공유하며 캐시 디스크 사용량/권한은 운영자 책임이다.
- **시간:** `-q`는 runner 시작 관측까지의 대기 제한, `-t`는 runner 시작 후 실행 제한이다. 큐 시간은 폴링 관측값(기본 2초 간격)이고 생성/API 호출 시간도 포함한다. runner 단계는 prep/install/services/test로 나누고 마지막 실패 단계와 각 완료/부분 단계 초를 기록한다. services는 TCP 포트만 보지 않고 SQL 및 S3 bucket PUT 응답을 확인한다.
- **종료:** runner는 자기 원래 종료코드와 결과를 기록한 뒤 수집을 최대 300초 기다린다. 호스트가 수집 후 `/artifacts/collected`를 만들면 runner가 종료하고, 호스트는 **Job의 True Complete/Failed**까지 추가 최대 360초 기다린다. 120초 뒤 UNKNOWN 처리하지 않는다. 서버 deadline은 `q+t+420`초로 최종 방어한다. 큐/실행 제한 초과 시 먼저 가능한 증거를 수집한 뒤 **자기가 생성한 Job만** 취소하고 삭제를 읽어 확인한다. API 실패 시 이 확인은 실패로 기록되고 서버 deadline이 남는다.
- **종료코드:** 성공 0, 테스트/설치 등 runner 실패는 실제 코드(예: 7/23), 서비스 준비 실패 69, 인프라/API 오류 70, 성공했으나 아티팩트 수집 실패 74, 큐/실행 제한 초과 124, Job이 NotFound가 되면 대기를 즉시 끝내고 70(outcome `job_lost`), SIGINT/SIGTERM/SIGHUP 수신 시 자기 Job만 정리한 뒤 130/143/129(outcome `interrupted`). 모든 경로는 마지막 줄에 `EXIT n`을 출력한다. Job Failed인데 runner 코드를 얻지 못하면 1이다. OOM/강제 종료 때는 살아 있는 컨테이너에서만 가능한 exec 수집이 실패할 수 있으며 이를 성공으로 보고하지 않는다.
- **산출물:** `-a`는 비어 있는 로컬 디렉터리여야 한다. 기본은 `<source>/artifacts/k3s-test/<timestamp>/`. `summary.json`, `runner-summary.json`, `runner.log`, `install.log`, `cache.txt`, `phases.tsv`, `metrics.jsonl`, `events.json`, 알려진 루트/`apps/web`의 `test-results`·`playwright-report`를 보존한다. metrics는 cgroup CPU/메모리 원문과 프로세스 RSS만 담고 환경 전체·명령행·Secret·Pod/Job 전체 원문은 저장하지 않는다. 테스트 자체 로그/trace는 테스트 데이터일지라도 로컬 민감 산출물로 취급한다. OOM/네트워크 단절/시간 초과에서는 일부 파일이 없을 수 있으며 summary의 `artifact_errors`를 확인한다.

## Compose/다른 격리 실행기에서 재사용

**동일 파일** `deploy/k8s/test/run-in-container.sh`를 컨테이너 안에서 `bash`로 실행한다. 별도의 prep/install/readiness 스크립트를 복제하지 않는다.

| 환경 변수 | 기본값 / 의미 |
|---|---|
| `TEST_CMD` | 필수. argv를 POSIX 셸 인코딩한 명령. 예: `pnpm test:e2e` |
| `RUNNER_SOURCE` | `/src`, 읽기 전용 checkout; `.env`를 주입하지 않음 |
| `RUNNER_WORK` | `/work`, 실행마다 새 writable directory |
| `RUNNER_ARTIFACTS` | `/artifacts`, writable 산출물/수집 handshake directory |
| `PNPM_STORE_DIR` | `/pnpm-store`, 실행마다 새 writable store |
| `RUNNER_CACHE` | 기본 빈 값(비활성). 캐시 volume을 연결할 때만 `/cache` 등 지정 |
| `COLLECT_WAIT_SECONDS` | `300`. 종료 후 Docker cp로 회수할 때까지 컨테이너를 보존하는 Compose 등은 `0` 가능 |
| `SERVICE_TIMEOUT_SECONDS` | `120`. SQL/S3 준비 제한 |

`NODE_ENV=development`, `CI=true`, `HOME=/tmp`는 컨테이너 실행 설정에서 지정한다. DB/S3는 같은 네트워크 namespace의 위 localhost 포트에 격리해 제공해야 한다. 일반 Compose의 별도 서비스 DNS만 제공하면 이 계약과 다르다. `/dev/shm`·CPU/메모리 한도도 비교 조건에 기록한다. 수집자는 `/artifacts/exit-code` 생성 후 디렉터리를 보존하고 `collected` 파일을 만들거나, 종료된 컨테이너를 유지한 채 `wait=0`과 Docker cp로 실제 종료코드·결과를 회수한다.

## 검증 경계

`test_runner.py`는 공개 `run-tests.sh`와 mock `kubectl` 실행 파일을 통해 Job 종료/종료코드/대기/수집 순서/템플릿 선택을 검증한다. `test_container.py`는 공개 공통 shell을 실행하고 설치·SQL·S3 호출만 mock하며 tar/Node/복사/캐시/실패 전파를 실제 실행한다. Node가 없는 호스트에서는 컨테이너 계약 테스트만 skip한다. 실제 k3s/E2E 성능과 Linux 이미지 도구 호환성은 별도 실측이 필요하다.

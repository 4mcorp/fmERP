# k3s 동적 테스트 러너

테스트마다 k3s `test` 네임스페이스에 Job을 만들어, 파드 하나 안에 격리 PostgreSQL(55433)·SeaweedFS S3(58333)·러너를 함께 띄운다. 앱의 localhost 테스트 안전 검사를 그대로 사용한다. 호스트의 브라우저 설치와 분리된 Linux 시험 환경이며, 배포 이미지·Ingress·TLS 검증을 대신하지 않는다.

```sh
deploy/k8s/test/run-tests.sh -w <worktree 절대경로> -q 900 -t 7200 -a <새 산출물 경로> pnpm test:e2e
# test:unit, test:int도 같은 인터페이스. 대기 예산 -q와 실행 예산 -t는 별도다.
# 선택 사항: -c /var/lib/fmerp-e2e-cache (VM의 실행 전용 cache 경로, 기본 비활성)
```

전체 옵션·종료코드·보관 파일·캐시 계약은 [실행기 README](../../deploy/k8s/test/README.md)를 따른다.

## 실행·격리 계약

- 전제: Python 3·kubectl, `test` 네임스페이스(infra 저장소 정의), Linux 테스트 이미지 `fmerp-worker:dev`, VM에서 읽을 수 있는 worktree 경로. 최신 실행기 템플릿과 `-w`의 시험 소스는 분리한다. 오래된 worktree의 10Gi 템플릿을 재사용하지 않는다.
- 테스트 소스는 읽기 전용으로 받고, `node_modules`·`.next`·`.worktrees`·`.git`·`.env*`·`.npmrc` 등을 복사에서 제외한 뒤 파드 안에서 Linux 의존성을 설치한다. **소스 준비가 끝날 때까지 worktree를 수정하지 않는다.** 불변 입력이 필요하면 고정된 체크아웃을 사용한다.
- 기본 이미지의 `pwuser` UID/GID 1001을 사용한다. root 초기화는 source·DB·Secret을 마운트하지 않은 실행 전용 볼륨의 소유권 설정으로 한정한다. 실제 러너는 non-root이며, corepack shim도 실행 전용 `/work/.runner-bin`에 만든다. 다른 `-i` 이미지는 이 UID와 Node·pnpm·브라우저·PostgreSQL 도구 호환성을 확인해야 한다.
- runner의 실제 종료코드와 Job terminal을 확인한다. 성공/실패 산출물·로그·단계 시간·metrics를 러너가 살아 있는 동안 로컬에 회수한 뒤 release한다. Job TTL은 회수 이후 정리 수단이지 산출물 저장소가 아니다.
- queue/runtime 시간 초과는 124이며 해당 실행의 Job만 취소한다. 복사·회수 오류를 성공으로 취급하지 않는다. `UNKNOWN`을 최종 결과로 보고하지 않는다.
- 의존성 캐시는 선택 사항이다. lockfile·플랫폼·Node/ABI·glibc·pnpm으로 나눈 불변 store snapshot을 실행별 private store로 복사한다. DB와 `node_modules`는 공유하지 않고 PVC·quota도 바꾸지 않는다.
- SeaweedFS는 `-s3.port.grpc=18333`을 명시한다. Service 환경변수 충돌을 막기 위해 `enableServiceLinks: false`를 유지한다.
- 기본은 `NODE_ENV=development`다. `E2E_SERVER_MODE=production`은 명시적 opt-in이며 build/start 양쪽에 기존 staging 테스트 환경을 적용한다. 운영 테스트 로그인 차단은 약화하지 않는다. **기본 모드 전환은 실측 후 별도로 판단한다.**
- 백업 통합 테스트의 `docker exec … pg_dump` 호출은 실행 전용 shim이 같은 파드의 pg 도구로만 처리한다. 외부 Docker daemon이나 운영 DB에 연결하지 않는다.

## 자원과 측정 기록

- runner requests 2Gi / limits 6Gi, DB·S3 각각 limits 1Gi를 유지한다. limits 합계는 8Gi다. 동시 실행 상한은 당시 namespace의 CPU·메모리 requests/limits를 모두 조회해 계산하며, quota 상향을 전제로 하지 않는다.
- 2026-10-25, `origin/dev 1bd9616` 관찰: E2E anon 최대 3.99GiB / memory.peak 6.57GiB, 통합 0.79 / 2.17, 단위 0.55 / 2.23, OOM 0건. memory.peak에는 회수 가능한 파일 캐시가 포함된다. 과거 4Gi 한도에서는 OOMKilled 이력이 있다(#61).
- 2026-10-26, 깨끗한 `cb9dcb4`의 **기존 러너 기준선**: 66 passed / 2 failed / 1 flaky / 3 skipped, Playwright 9.7분 / 전체 641.77초. 이번 실행에는 긴 quota 대기가 없었다. 새 코드의 성능 개선 결과로 해석하지 않는다.
- 위 기준선의 두 실패는 공통 PIN 폼 추출(#74) 이후 새 PIN·확인 입력과 기존 E2E 절차가 어긋난 사례다. 테스트 수정 후 실제 재검증 결과는 [개선 계획](../plan/2026-10-26-e2e-pipeline.md)에 별도로 기록한다. m4 양식 생성의 flaky도 원인 확정과 구분한다.
- 과거 2026-10-23의 62 passed / 7 failed 실행은 오래된 소스·10Gi 템플릿에 대한 기록이다. 당시 로케이터 문제는 #71에서 수정됐으므로 현재 수정 대상으로 재사용하지 않는다.

## CI와 대안 비교

- dev 대상 PR: 핵심 smoke + 변경 관련 E2E 필수. 검증된 UI 경로만 선택하며 service/domain/API/jobs·지도·공통/불명 변경은 전체로 폴백한다. main 대상 PR과 수동 전체 실행은 전체 E2E다.
- 읽기 전용 passkey는 핵심 집합이다. 계정/PIN 변경에 관련된 passkey 등록·로그인 흐름은 stateful이어도 관련 집합에 포함한다.
- Linux 격리 자체와 Kubernetes 필요성은 별개다. Compose 대안·production 모드는 총 준비 비용과 실제 시험 결과를 같은 이미지·자원·테스트 목록으로 비교한다. 실검증이 끝나기 전 기본 실행 위치를 전환하거나 속도 개선을 주장하지 않는다.

# k3s 동적 테스트 러너

테스트마다 k3s `test` 네임스페이스에 Job을 만들어, 파드 하나 안에 격리 postgres(55433)·SeaweedFS S3(58333)·러너를 함께 띄운다. 앱 기본 테스트 설정(localhost)을 그대로 쓴다. 호스트(macOS 13)는 Playwright chromium을 지원하지 않아 chromium 테스트도 여기서 실행한다.

```
deploy/k8s/test/run-tests.sh [-w <worktree 절대경로>] [-t <초>] pnpm test:unit   # test:int, test:e2e 도 동일
```
- 전제: `test` 네임스페이스(infra 저장소 정의), 이미지 `fmerp-worker:dev`(`deploy/k8s/build-images.sh dev`), `~/SW`가 colima에 마운트됨.
- 소스는 worktree를 읽기 전용으로 받고 파드 안에서 Linux용 `node_modules`를 설치한다. Job은 10분 뒤 자동 삭제.
- 종료코드는 Job 성공/실패를 따른다.
- 검증(2026-10-23): `test:unit` 통과, `test:int` 39파일 477테스트 통과, `test:e2e` 62통과·7실패(아래).
- E2E 7실패(데스크톱 `@stateful`, 모두 `일반 기안v1` 버튼을 못 찾아 타임아웃)는 러너 문제가 아닌 것으로 추정한다: 새 결재 화면의 카테고리 카드는 `CollapsibleCard defaultOpen=false`라 즐겨찾기·최근 사용이 비어 있는 새 DB에서는 양식 버튼이 접혀 있다(#41). 펼쳐서 통과시켜 확인하지는 않았다.
- 주의: SeaweedFS는 gRPC 포트를 S3 포트+10000으로 잡아 65535를 넘으므로 `-s3.port.grpc=18333`을 명시한다. 네임스페이스 quota(limits.cpu 12) 때문에 동시 Job은 약 3개까지.
- 러너 이미지는 `NODE_ENV=production` 고정이라 테스트 서버가 `DEV_TEST_LOGIN`과 충돌한다 → Job에서 `NODE_ENV=development`로 덮는다.
- 백업 통합 테스트는 `docker exec <컨테이너> pg_dump` 형태로 호출한다. 파드엔 docker가 없어 `/tmp/bin/docker` shim이 같은 파드의 pg 도구를 직접 실행하고(`-p 5432`→55433, `localhost`→127.0.0.1), `PGHOST/PGPORT`를 설정한다.
- E2E의 `next dev`+Chromium은 메모리를 많이 쓴다. 러너 limits 4Gi에서는 OOMKilled → 10Gi로 둔다. `test` 네임스페이스 quota는 limits.memory 20Gi.

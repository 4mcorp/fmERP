# k3s 동적 테스트 러너

테스트마다 k3s `test` 네임스페이스에 Job을 만들어, 파드 하나 안에 격리 postgres(55433)·SeaweedFS S3(58333)·러너를 함께 띄운다. 앱 기본 테스트 설정(localhost)을 그대로 쓴다. 호스트(macOS 13)는 Playwright chromium을 지원하지 않아 chromium 테스트도 여기서 실행한다.

```
deploy/k8s/test/run-tests.sh [-w <worktree 절대경로>] [-t <초>] pnpm test:unit   # test:int, test:e2e 도 동일
```
- 전제: `test` 네임스페이스(infra 저장소 정의), 이미지 `fmerp-worker:dev`(`deploy/k8s/build-images.sh dev`), `~/SW`가 colima에 마운트됨.
- 소스는 worktree를 읽기 전용으로 받고 파드 안에서 Linux용 `node_modules`를 설치한다. Job은 10분 뒤 자동 삭제.
- 종료코드는 Job 성공/실패를 따른다.
- 검증: `pnpm test:unit` 42파일 434테스트 통과. `test:int`·E2E는 미검증.
- 주의: SeaweedFS는 gRPC 포트를 S3 포트+10000으로 잡아 65535를 넘으므로 `-s3.port.grpc=18333`을 명시한다. 네임스페이스 quota(limits.cpu 12) 때문에 동시 Job은 약 3개까지.

---
title: 블록 렌더러의 웹폰트·PDF·격리 단위 시험 검증 경로
date: 2026-11-01
status: resolved
tags: [ui, pdf, fonts, test, playwright, k3s]
related: [docs/plan/2026-10-30-form-block-editor.md, features/completion/tests/block-render.test.ts]
---

## 증상과 원인

- macOS 13에서 Playwright 1.63 Chromium 설치가 `does not support chromium on mac13`로 실패한다. 기본 Chromium을 쓰는 기존 `render.test.ts` 3건은 실행 파일이 없어 실패한다. 테스트를 생략해 통과 처리하지 않는다.
- 기존 `apps/web/server/e2e-server-mode.test.ts`의 한 시험은 CLI를 여러 번 동기 실행하므로 이 Mac과 k3s 러너에서 기본 5초를 넘었다. 기대값 실패가 아닌 시간 제한이다. 파일 단독 실행에서도 같은 시간 제한을 확인했다.
- `sandbox=""` srcdoc은 opaque origin이다. 웹폰트가 공개 정적 파일이어도 CORS 응답이 없으면 로드되지 않는다. Playwright 가상 호스트 route로 이 흐름을 모사했을 때 sandbox의 글꼴 요청이 인터셉트되지 않고 DNS 오류로 실패한 사례도 있었다. 이는 실제 파일의 잘못된 주소로 판정하지 않는다.
- k3s `run-tests.sh`는 명령의 **argv**를 받고 `shlex.join`한다. `'pnpm test:unit'`처럼 전체를 한 인자로 넣으면 공백을 포함한 실행 파일 이름을 찾다가 exit 127로 끝난다.
- 이 VM에는 프로젝트 경로는 공유되지만 Hermes profile cache는 공유되지 않는다. cache 안 worktree로 러너를 실행하면 hostPath `is not a directory`로 파드가 시작하지 못한다.

## 해결

1. 새 브라우저 배치 시험은 macOS에서 설치된 Chrome 채널, Linux에서 기본 Playwright Chromium을 사용한다. 실제 worker의 `renderPdf`는 변경하지 않고 Linux 격리 러너에서 확인한다.
2. 중간 전체 단위 시험은 k3s에서 `pnpm test:unit --testTimeout=20000`으로 모든 기대값을 유지한 채 통과했다. 그러나 이것을 기본 조건 통과로 대체하지 않았다. 최종 코드는 **기본 5초를 유지한** `pnpm test:unit --maxWorkers=1`로 69파일·671시험 모두 통과했다(job `fmerp-test-vw672`). 깨끗한 같은 dev `99b0c2f`도 같은 러너의 기본 `pnpm test:unit`으로 66파일·662시험 통과했다(job `fmerp-test-tjfcc`). 따라서 앞선 timeout을 기존 실패라고 분류하지 않는다. 테스트·게이트 파일은 바꾸지 않았고 CI는 저장소 기본 병렬 설정을 그대로 쓴다.
3. 승인된 woff2를 worker/web 양쪽에 두고 `Buffer.equals`로 동일성을 검사한다. 큰 Buffer의 `toEqual`은 이 환경에서 비교만 수 초가 걸려 5초 제한에 걸렸으므로 쓰지 않는다.
4. Next 설정의 공개 `/fonts/*`에만 `Access-Control-Allow-Origin: *`를 설정한다. 시험은 실제 loopback HTTP 서버에서 같은 헤더와 실제 woff2를 제공해 opaque iframe의 `document.fonts.ready`·400/700 로드·요청 파일을 확인한다. 앱/API에는 CORS를 추가하지 않는다.
5. PDF를 화면 screenshot만으로 판정하지 않는다. 실제 `page.pdf()` 산출물을 macOS PDFKit으로 읽어 페이지 이미지·텍스트를 만들고 행/문단 식별자의 순서·누락·중복과 표 머리글 반복을 확인한다.

## 재발 방지 규칙

- k3s 명령은 `deploy/k8s/test/run-tests.sh -w <프로젝트 내부 worktree> -t 7200 pnpm test:unit`처럼 argv를 나누어 넘긴다. 복합 명령만 `bash -ec '<명령>'`을 사용한다.
- k3s source worktree와 산출물 snapshot은 VM이 공유하는 프로젝트 경로에 둔다. hostPath FailedMount는 CPU/메모리 쿼터 문제로 오인하지 않는다.
- 브라우저 API·DNS·CORS 문제를 구분하려면 console/request 실패와 글꼴 상태를 먼저 읽는다. 가상 route가 opaque iframe을 놓치면 실제 loopback HTTP 서버로 검증한다.
- 전체 단위 실패를 기존 실패라고 부르기 전에 깨끗한 같은 dev 커밋을 같은 러너에서 대조한다. timeout 옵션과 원래 실패를 함께 보고한다.
- 웹폰트는 출처가 다른 opaque srcdoc에서도 검사한다. 글꼴만을 위해 iframe의 sandbox 권한을 확대하지 않는다.

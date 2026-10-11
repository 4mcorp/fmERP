---
title: 기능별 선택 CI와 main 병합 전 E2E
date: 2026-10-12
status: done
tags: [ci, test, infra]
related: [.github/workflows/ci.yml, .github/workflows/e2e.yml]
---

## 범위와 실행 정책

완료 범위는 로컬 구현·검증이다. 커밋, 푸시, PR, 실제 GitHub Actions 실행 및 시간 단축 실측은 별도 승인·배포 단계다.

- dev 대상 PR: 변경 기능의 단위 테스트 matrix, 기능 밖 단위 테스트, 전체 통합 테스트를 별도 병렬 잡으로 실행한다.
- 공통 코드·루트 설정·CI 구현 변경, 비교 실패, push(dev/main), main PR: 전체 단위·통합 실행으로 fallback한다.
- 문서·E2E 전용 파일·보호 정책 변경만 있으면 단위·통합은 생략하되 정적 게이트는 유지한다.
- 단위 테스트만 실행하는 feature/core 잡에는 DB·S3 기동이 필요 없다. completion 단위 PDF 렌더 시험만 Chromium을 설치한다.
- main PR: 재사용 e2e.yml(workflow_call)을 호출한다. 기존 원격 필수 체크 check가 E2E 성공·리포트·게이트까지 검증하므로 별도 원격 e2e 체크 추가는 필요 없다. 기존 policy가 dev→main만 허용한다.
- check는 선택된 잡의 실패·취소·예상하지 않은 skip, 누락된 artifact, 누락/중복된 gate를 실패시킨다.

## 통합 테스트를 전체 실행하는 이유

기능 간 직접 import 금지만으로 테스트 독립성이 보장되지 않는다. apps/web/server/test-support.ts가 completion의 generatePackage를 shared/testing/package-generator에 주입한다. approval-m5-download.int.test.ts 및 backup의 export/reindex/rehearse.int.test.ts가 이 접점을 사용한다. completion만 골라 돌리면 이 소비자 테스트를 놓친다. 현재는 누락 방지를 위해 전체 integration을 한 잡에서 실행한다. 통합 테스트까지 feature 단위 선택하려면 주입·표 접근·이벤트 소비를 포함한 검증된 영향 그래프를 먼저 도입해야 한다.

## 로컬 검증 (2026-10-12)

- CI Python 회귀: 31개 중 30개 통과, Windows 줄바꿈 파일명 1개 생략.
- Bash 문법 검사 및 actionlint: 통과. actionlint 실행 시 ShellCheck는 비활성화.
- 단위: 42파일 / 434개 통과.
- 통합: 32파일 / 418개 통과 (독립 테스트 DB 및 S3 사용).
- E2E: 53개 통과, 기존 조건으로 3개 생략 (desktop/mobile).
- Biome: 오류 0, 기존 경고 6개. 타입 검사, arch:check, arch:guard 통과.
- 로컬 Node는 26.7.0으로 프로젝트의 Node 24 요구와 다르다. Actions는 .nvmrc로 지정된 버전을 사용하며 원격 실행은 미검증이다.
- 독립 리뷰: fmerp-reviewer 프로파일을 openai-codex / gpt-6.1-sol로 단일 실행해 검토 통과(지속 설정 변경 없음). 초기 리뷰의 범위·artifact 충돌 지적은 실제 Vitest 설정 및 파일 집합 대조 후 재검토해 오류가 아님을 확인했다.
- 실제 Vitest unit 파일 집합은 전체 42 = core 20 + feature 22이며, 중복·누락은 없다.

## 테스트 격리

DB reset의 55433 안전 검사를 유지한다. 기존 테스트 PostgreSQL 서버에 실행 전용 DB를 각각 만들고, S3는 별도 Compose 프로젝트/볼륨을 사용했다. 개발 DB(55432)는 초기화하지 않았다. E2E 전용 env의 임시 주소 변경은 실행 후 바이트 단위로 복원했다. 백업 시험의 pg_dump DB 이름은 고정 fmerp 대신 BACKUP_DATABASE_URL에서 가져오게 수정해 호스트 조회 DB와 컨테이너 덤프 DB를 일치시켰다.

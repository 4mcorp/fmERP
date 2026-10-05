# 스테이징 구축·운영 절차

> 상태: **초안, 미검증.** 이 PC에서는 Cloudflare Tunnel·Access와 별도 서버를 만들 수 없어, 아래 절차는 실제 서버에서 처음 실행해 보며 확인한다. 확인한 결과와 고친 점은 맨 아래 "검증 기록"에 남긴다.
> 기준: [DEPLOYMENT_PLAN](../DEPLOYMENT_PLAN.md) 6·7장, 파일: `docker-compose.staging.yml`, `apps/web/Dockerfile`, `apps/worker/Dockerfile`, `.env.staging.example`

## 1. 무엇이 다른가
| 항목 | 운영 | 스테이징 |
|---|---|---|
| Compose 프로젝트 | `fmerp-prod` | `fmerp-staging` (DB·볼륨·네트워크가 따로) |
| 호스트 이름 | `erp.<도메인>` | `staging.<도메인>` + **Cloudflare Access** |
| 로그인 | 소셜 로그인(M9) | **테스트 로그인**(시드 계정) — `APP_ENV=staging` + `DEV_TEST_LOGIN=true` |
| 데이터 | 실제 | 시드 테스트 계정, 익명화 샘플, 복구 리허설 |
| S3 버킷 | 운영 버킷 | **스테이징 전용 버킷·키** |
| 메모리 상한 | – | 합계 3GB (postgres 512 + web 640 + worker 1536 + cloudflared 128) |
| Tunnel | 운영 Tunnel | **별도 Tunnel**(토큰이 다르다) |

테스트 로그인은 누구나 시드 계정으로 들어갈 수 있게 하므로 **Cloudflare Access 정책이 먼저 적용된 뒤에만** 켠다 (3장 순서 참고). `resolveDevTestLogin`은 운영 모드(`NODE_ENV=production`)에서 `APP_ENV=staging`이 아니면 서버가 기동되지 않게 막는다(`packages/auth/src/dev-login.ts`). 운영 `.env`에는 `APP_ENV`와 `DEV_TEST_LOGIN`을 넣지 않는다.

## 2. 사전 준비 (사람이 한다)
1. Cloudflare에 도메인을 올린다(네임서버 이전).
2. Zero Trust → Networks → Tunnels에서 **스테이징 전용 Tunnel**을 만들고 토큰을 `.env.staging`의 `STAGING_TUNNEL_TOKEN`에 넣는다. 공개 호스트 이름: `staging.<도메인>` → `http://web-staging:3000`.
3. 스테이징 전용 S3 버킷과 키를 만든다. 수명 주기 규칙은 운영과 같이 `_staging/` 1일, 덤프 7·28일, 내보내기 7일 ([rules/storage-backup.md](../rules/storage-backup.md)).
4. `age-keygen`으로 스테이징용 키 쌍을 만들고 **공개키만** `BACKUP_AGE_RECIPIENTS`에 넣는다. 개인키는 서버 밖(비밀번호 관리자)에 둔다.
5. `.env.staging.example`을 `.env.staging`으로 복사해 값을 채운다. 비밀번호는 역할마다 다르게 충분히 길게, `BETTER_AUTH_SECRET`은 32자 이상 무작위 값으로 한다. 이 파일은 git에 넣지 않는다.

## 3. 처음 올리는 순서
Access가 먼저, 앱은 나중이다.
1. **Cloudflare Access 앱 만들기:** Zero Trust → Access → Applications → Self-hosted. 도메인 `staging.<도메인>`, 정책은 "허용 이메일 목록"(Allow, 팀원 이메일만)과 기본 거부. 인증 방식은 이메일 OTP 또는 Google. 세션은 24시간 이하.
2. **서버에서 올리기:**
   ```bash
   docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build
   ```
   `postgres`가 처음 뜰 때 `docker/postgres/initdb/01-roles.sh`가 DB 역할을 만들고, `migrate`가 마이그레이션을 적용한 뒤에 `web-staging`·`worker-staging`이 시작된다.
3. **테스트 계정 시드(처음 한 번, 필요할 때만):**
   ```bash
   docker compose -f docker-compose.staging.yml --env-file .env.staging --profile seed run --rm seed
   ```
4. **확인:** 허용되지 않은 이메일로 `https://staging.<도메인>`을 열면 Access 화면에서 막히는지, 허용된 이메일은 `/dev-login`까지 가는지 본다.

## 4. 배포(갱신)
1. 운영 배포 전 이 순서로 스테이징에 먼저 올려 본다 (DEPLOYMENT_PLAN 9장).
2. `git pull` → `docker compose ... up -d --build`. `migrate`가 새 마이그레이션을 적용한다.
3. 새 마이그레이션이 만든 DB 역할·권한이 기존 볼륨에 필요하면 `docs/ts/2026-10-05-backup-role-existing-volume.md`처럼 직접 SQL을 실행한다.
4. 쓰지 않을 때는 내려서 메모리를 돌려준다:
   ```bash
   docker compose -f docker-compose.staging.yml --env-file .env.staging down
   ```
   (`down -v`는 DB 볼륨을 지우므로 데이터를 버릴 때만 쓴다.)

## 5. 복구 리허설에 쓰기
분기 1회 [migration.md](./migration.md)의 복구 절차를 스테이징에서 실행한다. 운영 덤프를 쓰면 **실제 고객 데이터가 스테이징에 들어오므로** 하지 말고, 스테이징에서 만든 덤프로만 리허설한다. 운영 덤프로 리허설해야 하면 익명화한 뒤에 쓴다.

## 6. 텔레그램 알림
스테이징에서는 폴링(기본)으로 충분하다. 웹훅을 시험하려면 `TELEGRAM_WEBHOOK_SECRET`을 넣고 시스템 설정 화면에서 전환한다. 단 Cloudflare Access가 `staging.<도메인>` 전체를 막으면 텔레그램 서버의 웹훅 요청도 막히므로, **`/api/telegram/webhook` 경로만 Access 우회(Bypass) 정책**을 추가해야 한다. 이 경로는 비밀 헤더로 인증한다. 운영 봇과 스테이징 봇은 반드시 다른 봇을 쓴다(같은 봇을 두 곳에서 폴링하면 409).

## 7. 검증 기록
| 날짜 | 항목 | 결과 |
|---|---|---|
| 2026-10-06 | `docker compose -f docker-compose.staging.yml config` 문법 | 통과 (실제 기동은 하지 않음) |
| 2026-10-06 | web 이미지 빌드(`--target runner`) | 통과 (이 PC의 Docker, 약 3분) |
| 2026-10-06 | web 이미지를 개발 DB에 붙여 실행 | `/api/health` 정상. `NODE_ENV=production` + `DEV_TEST_LOGIN=true` + `APP_ENV=staging`이면 테스트 로그인 가능, `APP_ENV` 없이 켜면 로그인 API가 500(가드 예외)으로 막힘. 가드 예외는 기동 시점이 아니라 첫 요청에서 난다 |
| – | worker 이미지 빌드, `migrate` 서비스(builder 단계)와 `seed` 서비스 실행 | **미검증** (Playwright 베이스 이미지가 커서 이번에는 받지 않음) |
| – | Cloudflare Tunnel 연결, Access 정책, 서버 기동, 시드, 배포 갱신 | **미검증** (실제 서버·도메인 필요) |

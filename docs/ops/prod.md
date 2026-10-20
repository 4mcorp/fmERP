# 운영(prod) Compose 구축·접속 절차 (초안, 미검증)

대상: 사내 로컬 서버 1대. 접근 경로는 **Tailscale tailnet(MagicDNS, HTTPS)** 하나다. Cloudflare Tunnel은 prod에서 쓰지 않는다 (staging 전용 — [staging.md](staging.md)).
구성 파일: `docker-compose.prod.yml`(프로젝트 `fmerp-prod`), `docker/tailscale/serve.json.tmpl`, `.env.prod.example`.

## 1. 구성 요소

| 서비스 | 이미지 | 역할 | 네트워크 |
|---|---|---|---|
| postgres | postgres:18-bookworm | DB (역할별 비밀번호, initdb) | internal |
| migrate | apps/web/Dockerfile (builder) | 배포마다 1회 마이그레이션. 시드 없음 | internal |
| web | apps/web/Dockerfile (runner) | Next + Hono `/api` (3000) | edge, internal |
| worker | apps/worker/Dockerfile | pg-boss 워커·백업 | internal |
| tailscale | tailscale/tailscale:v1.104.1 | tailnet 연결, `tailscale serve`로 web:3000을 HTTPS 노출 | edge |

- `ports:`는 어느 서비스에도 두지 않는다. Docker가 연 포트는 호스트 방화벽을 우회하므로 tailnet 밖에서 닿을 수 있다.
- 운영에는 `DEV_TEST_LOGIN`을 켜지 않는다 (prod compose에 없음). 시드(테스트 계정)도 실행하지 않는다.
- Google OAuth 로그인은 이 단계에서 비활성화한다. 로그인은 passkey로 한다 (passkey 플러그인 연결은 별도 작업).

## 2. 서버 준비 (최초 1회)

1. Docker Engine + Compose 플러그인 설치 (`docker compose version`으로 확인).
2. 저장소를 서버에 클론하고 `git checkout origin/dev`(또는 배포 태그).
3. `cp .env.prod.example .env.prod` 후 값을 채운다. **`.env.prod`는 커밋하지 않는다** (`.gitignore`의 `.env.*`).
   - `PROD_FQDN`: Tailscale 관리 콘솔 Machines에서 확인하는 MagicDNS 이름 (예: `fmerp.<tailnet>.ts.net`).
   - 비밀번호·키는 서버의 `.env.prod`에만 둔다. 로그·채팅·외부 도구에 넣지 않는다.
4. 필수 값이 빠지면 Compose가 기동 전에 실패한다 (`${VAR:?...}`). 확인: `docker compose -f docker-compose.prod.yml --env-file .env.prod config --quiet`.

## 3. 기동

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
docker compose -f docker-compose.prod.yml --env-file .env.prod logs migrate   # exit 0 이어야 함
```

업데이트 배포: `git pull` 후 같은 명령 재실행 (migrate가 먼저 돈다).

## 4. Tailscale 키·ACL 발급

1. **tailnet ACL**: 관리 콘솔 Access controls에 태그를 정의한다.
   ```json
   "tagOwners": { "tag:fmerp-prod": ["autogroup:admin"] },
   "acls": [
     { "action": "accept", "src": ["autogroup:member"], "dst": ["tag:fmerp-prod:443"] }
   ]
   ```
   사용자 기기만 443에 접근하게 하고, 태그 기기끼리의 임의 접근은 막는다. 기본 정책이 `*:*`이면 이 항목을 추가한 뒤 기존 규칙을 조정한다.
2. **MagicDNS**: DNS 설정에서 MagicDNS와 HTTPS 인증서(Certificates)를 켠다. HTTPS 없이는 PWA·passkey·push가 동작하지 않는다.
3. **auth key**: Settings → Keys → Generate auth key. 옵션: Reusable **끔**, Ephemeral **끔**, Expiry 짧게(1일), Tags `tag:fmerp-prod`. 발급 값을 `.env.prod`의 `TS_AUTHKEY`에 넣는다.
4. 첫 기동 후에는 state 볼륨(`tailscale-state`)에 노드 키가 남으므로 `TS_AUTHKEY`를 비워도 된다. 키를 지우고 `.env.prod`를 다시 적용한다.

## 5. MagicDNS 접속 확인

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec tailscale tailscale status
docker compose -f docker-compose.prod.yml --env-file .env.prod logs tailscale
```

- 같은 tailnet의 기기에서 `https://<PROD_FQDN>/` 접속. 인증서 경고가 없어야 한다.
- tailnet 밖(휴대폰 Wi-Fi 끄고 데이터만 켠 상태 등)에서는 접속되지 않아야 한다.
- 호스트 포트 확인: `docker compose ... ps`에서 PORTS 열이 비어 있어야 한다.

## 6. 사용자 흐름 (휴대폰)

1. Tailscale 앱 설치 → 회사 계정으로 로그인 → tailnet 연결 확인.
2. 브라우저(Safari 또는 삼성 인터넷)에서 `https://<PROD_FQDN>/` 접속.
3. 로그인 (passkey).
4. 홈 화면에 추가: Safari는 공유 → "홈 화면에 추가", 삼성 인터넷은 메뉴 → "페이지 추가" → "홈 화면".
5. 홈 화면 아이콘으로 실행하면 앱 셸로 열린다. 알림(push) 권한은 앱 실행 후 허용한다 (iOS는 홈 화면 실행 상태에서만 push 가능).

## 7. dev·staging과 분리 증거

| 항목 | dev (`docker-compose.dev.yml`) | staging (`docker-compose.staging.yml`) | prod (`docker-compose.prod.yml`) |
|---|---|---|---|
| 프로젝트명 (`name:`) | fmerp-dev | fmerp-staging | fmerp-prod |
| 호스트 포트 (`ports:`) | 있음 (개발용) | 없음 | 없음 |
| 외부 접근 | 로컬 | Cloudflare Tunnel (Access) | Tailscale tailnet (MagicDNS) |
| 볼륨 | pgdata (프로젝트 접두사) | pgdata (프로젝트 접두사) | pgdata, tailscale-state (프로젝트 접두사) |
| 네트워크 | 기본 | edge, internal | edge, internal |
| 테스트 로그인 | 켜짐 | 켜짐 (APP_ENV=staging) | **꺼짐** (환경변수 없음) |
| env 파일 | `.env` | `.env.staging` | `.env.prod` |

검증 결과(구성 정적 검사): 프로젝트명 3개가 서로 다르고, 렌더링된 볼륨·네트워크 이름은 프로젝트 접두사로 모두 분리된다. 호스트 포트를 연 서비스는 prod에 없다.

## 8. 미검증 항목

- tailscale 컨테이너 실제 기동, MagicDNS 이름 발급, HTTPS 인증서 발급: 실제 tailnet auth key가 필요하다. 키 없이는 검증할 수 없다.
- 휴대폰 홈 화면 추가와 push 수신: 실기기 확인 필요.
- passkey rpID 연결: 인증 플러그인 작업에서 `PROD_FQDN`을 rpID로 설정한다 (아직 코드 미연결).

## 9. GitHub Actions 자동 배포 (초안, 미검증)

워크플로: `.github/workflows/deploy-prod.yml`. 서버 스크립트: `tools/deploy/deploy-prod.sh`.
흐름: `main` 병합(push) 또는 수동 실행 → **gate**(같은 커밋의 CI `check` 성공 확인) → **deploy**(Tailscale 임시 노드 `tag:ci`로 tailnet 접속 → SSH로 서버의 스크립트 실행 → 외부 HTTPS `/api/health` 확인). 실패하면 직전 이미지로 롤백하고 job을 실패로 끝낸다.

### 9.1 서버 준비 (최초 1회)

1. `sshd`는 tailnet 쪽에서만 받는다. 호스트 방화벽에서 22를 `tailscale0` 인터페이스로만 허용한다 (공인 IP의 22는 막는다).
2. 배포 전용 사용자(예: `deploy`)를 만들고 `docker` 그룹에 넣는다. 그 사용자의 `authorized_keys`에 배포 전용 키(공개키)를 넣는다. 개인키는 GitHub secret에만 둔다.
3. 저장소를 `PROD_DEPLOY_DIR` 경로에 클론한다. 서버가 `origin`을 `git fetch`할 수 있어야 한다 (읽기 전용 deploy key 또는 공개 저장소).
4. 서버의 `.env.prod`를 2장 절차대로 채운다. 배포 스크립트는 이 파일을 읽기만 한다.
5. 서버 호스트 키 지문을 확인하고 `PROD_KNOWN_HOSTS` secret에 넣는다. `ssh-keyscan` 결과를 그대로 믿지 말고 서버에서 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`로 지문을 대조한다.

### 9.2 Tailscale OAuth client 발급

1. Tailscale 관리 콘솔 Settings → OAuth clients → Generate OAuth client.
2. 범위(scope): **`auth_keys` (쓰기)**만 준다. 다른 범위는 주지 않는다.
3. Tags: `tag:ci`. 발급된 Client ID와 Client secret을 GitHub secret에 넣는다 (아래 9.4). Client secret은 이 화면에서만 보인다.
4. ACL의 `tagOwners`에 `tag:ci`가 이 클라이언트 소유자로 정의돼 있어야 한다 (아래 9.3).

### 9.3 tailnet ACL 예시 (배포 전용 규칙 추가)

4장의 ACL에 아래를 더한다. `tag:ci`는 **배포 서버 2개 포트**만 쓰고, 다른 기기에는 닿지 않는다.

```json
"tagOwners": {
  "tag:fmerp-prod": ["autogroup:admin"],
  "tag:ci": ["autogroup:admin"]
},
"acls": [
  { "action": "accept", "src": ["autogroup:member"], "dst": ["tag:fmerp-prod:443"] },
  { "action": "accept", "src": ["tag:ci"], "dst": ["tag:fmerp-prod:22"] },
  { "action": "accept", "src": ["tag:ci"], "dst": ["tag:fmerp-prod:443"] }
]
```

- `:22`는 SSH(배포 스크립트 실행), `:443`은 CI의 외부 헬스체크다.
- 기본 정책이 `*:*`이면 `tag:ci`가 다른 기기에도 닿는다. 위 규칙을 넣은 뒤 기본 허용을 조정한다.
- ACL 파일은 사람(관리자)이 바꾼다. 워크플로로 바꾸지 않는다.

### 9.4 GitHub 설정 (비밀은 secrets/vars에만)

GitHub 저장소 Settings → Environments에 **`prod`** 환경을 만들고 "Required reviewers"를 켠다. 배포 job은 이 환경을 쓴다.

| 종류 | 이름 | 내용 |
|---|---|---|
| secret | `TS_OAUTH_CLIENT_ID` | 9.2의 Client ID |
| secret | `TS_OAUTH_SECRET` | 9.2의 Client secret |
| secret | `PROD_SSH_KEY` | 배포 전용 SSH 개인키 (서버 `authorized_keys`에 공개키) |
| secret | `PROD_KNOWN_HOSTS` | 서버 호스트 키 한 줄 (9.1-5) |
| var | `PROD_SSH_HOST` | 서버 호스트의 MagicDNS 이름 (SSH 대상, 예: `fmerp-host.<tailnet>.ts.net`) |
| var | `PROD_FQDN` | compose의 tailscale이 여는 HTTPS 이름 (`.env.prod`의 `PROD_FQDN`과 같은 값) |
| var | `PROD_SSH_USER` | 배포 사용자 이름 |
| var | `PROD_DEPLOY_DIR` | 서버의 저장소 경로 |

- 값은 워크플로 파일·로그·PR 본문에 넣지 않는다. 로그에 값이 찍히면 즉시 secret을 재발급한다.
- `PROD_SSH_HOST`와 `PROD_FQDN`은 다르다. 전자는 서버 호스트(sshd), 후자는 compose 안 tailscale 노드가 여는 HTTPS 이름이다.

### 9.5 배포 gate의 CI 확인 범위 (check만 본다)

스펙의 "CI(check/policy) 성공한 커밋만 배포"에서 gate는 `check`만 확인하고 `policy`는 확인하지 않는다. 근거:

- `.github/rulesets/main.json`(main-protection, enforcement active)이 `required_status_checks`로 `check`와 `policy`를 둘 다 필수로 요구한다. main에 도달한 커밋은 PR 단계에서 두 체크를 모두 통과한 것이다.
- `policy.yml`은 `on: pull_request`만 있다. main push로 생긴 커밋(merge 커밋 SHA)에는 policy check run이 생기지 않으므로, gate에 `policy`를 넣으면 40분 대기 뒤 실패한다(교착).
- 한계: 이 근거는 ruleset이 유지될 때만 성립한다. ruleset에서 `policy`가 빠지면 gate에도 `policy` 확인을 추가해야 한다. ruleset 변경은 사람이 한다.

### 9.6 배포 스크립트 동작

`tools/deploy/deploy-prod.sh deploy <커밋 SHA>` (서버 저장소 루트에서 실행):

1. SHA 형식 검사, `.env.prod` 존재, `docker compose config --quiet`로 필수 값 확인.
2. 현재 `web`·`worker` 이미지를 `:previous`로 보관한다 (최초 배포면 건너뛴다).
3. `git fetch`, 대상 커밋으로 detach checkout.
4. `migrate` 컨테이너를 지우고 `up -d --build`. `migrate`가 끝날 때까지 기다리고 종료 코드 0을 확인한다.
5. `web` 컨테이너 안에서 `/api/health` 200을 3분 안에 확인한다.

`tools/deploy/deploy-prod.sh rollback`: `:previous` 이미지를 `:latest`로 되돌리고 `web`·`worker`를 `--no-build`로 다시 띄운 뒤 헬스체크를 본다. **DB 마이그레이션은 되돌리지 않는다.** 마이그레이션이 되돌릴 수 없는 변경을 포함했다면 롤백 대신 백업 복구를 판단한다 (DEPLOYMENT_PLAN 8장).

상태 기록은 `~/.fmerp-deploy/prod.state`에 한 줄씩 남는다 (시각·커밋·결과, 비밀값 없음).

로컬 dry-run: `DRY_RUN=1 bash tools/deploy/deploy-prod.sh deploy <40자 SHA>`. 실제 명령은 실행하지 않고 순서만 출력한다.

### 9.7 미검증 항목 (실제 입력 없이는 확인 불가)

- Tailscale OAuth 연결, `tag:ci` 노드의 `:22`·`:443` 접근 (실제 OAuth client와 ACL 필요).
- 서버에서 `deploy-prod.sh`의 실제 실행, migrate 대기, 헬스체크, 롤백 (실제 서버·`.env.prod` 필요).
- Compose가 이미지를 `fmerp-prod-web`·`fmerp-prod-worker`로 이름 짓는지 (`:previous` 태그 기준). 서버에서 `docker images`로 한 번 확인한다.
- `prod` 환경의 필수 승인자 설정, 외부 헬스체크의 재시도 간격.

### 9.8 사용자가 준비해야 할 입력

1. 9.2의 Tailscale OAuth client ID·secret (`auth_keys` 쓰기, tag:ci).
2. 9.3 ACL 반영 권한 (관리자).
3. 서버: 배포 사용자·배포 키 공개키, 저장소 클론 경로, 호스트 키 지문, sshd의 tailnet 한정 설정.
4. 9.4의 secrets·vars 값과 `prod` 환경(필수 승인자).

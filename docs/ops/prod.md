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

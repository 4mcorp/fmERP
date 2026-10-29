#!/usr/bin/env bash
# 운영(prod) 배포 스크립트. 운영 서버의 저장소 루트에서 실행한다 (GitHub Actions deploy-prod.yml이 SSH로 호출).
# 사용:
#   bash tools/deploy/deploy-prod.sh deploy <커밋 SHA 40자>
#   bash tools/deploy/deploy-prod.sh rollback
# 환경 변수:
#   DRY_RUN=1          실행하지 않고 명령만 출력한다 (로컬 검증용)
#   DEPLOY_STATE_DIR   배포 상태 기록 위치 (기본 $HOME/.fmerp-deploy, 저장소 밖)
# 롤백은 앱 이미지(web·worker)만 되돌린다. DB 마이그레이션은 되돌리지 않는다 (docs/ops/prod.md 9장).
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.prod"
STATE_DIR="${DEPLOY_STATE_DIR:-$HOME/.fmerp-deploy}"
STATE_FILE="$STATE_DIR/prod.state"
HEALTH_JS="fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
APP_SERVICES=(web worker)

log() { printf '[deploy-prod] %s\n' "$*"; }
die() { printf '[deploy-prod] 실패: %s\n' "$*" >&2; exit 1; }
dry() { [[ "${DRY_RUN:-0}" == "1" ]]; }

# 명령 실행. DRY_RUN=1이면 출력만 한다
run() {
  if dry; then
    printf '[dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# 상태 기록: 어떤 커밋을 어떤 시각에 올렸는지 (비밀값은 쓰지 않는다)
record() {
  dry && { printf '[dry-run] record %s\n' "$*"; return 0; }
  mkdir -p "$STATE_DIR"
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$STATE_FILE"
}

# 현재 이미지를 :previous로 남겨 롤백할 수 있게 한다 (Compose 기본 이미지 이름: <프로젝트>-<서비스>)
keep_previous() {
  local svc img
  for svc in "${APP_SERVICES[@]}"; do
    img="fmerp-prod-${svc}"
    if dry; then
      printf '[dry-run] docker tag %s:latest %s:previous (있을 때)\n' "$img" "$img"
    elif docker image inspect "${img}:latest" >/dev/null 2>&1; then
      docker tag "${img}:latest" "${img}:previous"
      log "이전 이미지 보관: ${img}:previous"
    else
      log "보관할 이전 이미지 없음 (${img}): 최초 배포로 본다"
    fi
  done
}

# migrate 컨테이너가 끝날 때까지 기다리고 종료 코드가 0인지 본다
wait_migrate() {
  if dry; then
    printf '[dry-run] migrate 종료 코드 0 대기\n'
    return 0
  fi
  local cid status code
  cid="$(dc ps -a -q migrate)"
  [[ -n "$cid" ]] || die "migrate 컨테이너를 찾지 못했다"
  for _ in $(seq 1 90); do # 최대 15분 (10초 간격)
    status="$(docker inspect -f '{{.State.Status}}' "$cid")"
    if [[ "$status" == "exited" ]]; then
      code="$(docker inspect -f '{{.State.ExitCode}}' "$cid")"
      if [[ "$code" == "0" ]]; then
        log "migrate 완료 (exit 0)"
        return 0
      fi
      dc logs --no-color migrate | tail -n 50 >&2 || true
      die "migrate 실패 (exit $code)"
    fi
    sleep 10
  done
  die "migrate가 15분 안에 끝나지 않았다"
}

# web 컨테이너 안에서 /api/health 200을 확인한다 (최대 3분)
wait_health() {
  if dry; then
    printf '[dry-run] web 컨테이너 /api/health 대기\n'
    return 0
  fi
  for _ in $(seq 1 18); do
    if dc exec -T web node -e "$HEALTH_JS" >/dev/null 2>&1; then
      log "web /api/health 200"
      return 0
    fi
    sleep 10
  done
  return 1
}

check_preconditions() {
  dry && return 0
  [[ -f "$COMPOSE_FILE" ]] || die "$COMPOSE_FILE 없음. 저장소 루트에서 실행한다"
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE 없음 (docs/ops/prod.md 2장)"
  # 필수 값이 빠지면 여기서 멈춘다 (빌드 전)
  dc config --quiet || die "compose 설정 검사 실패"
}

deploy() {
  local sha="$1"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "커밋 SHA 40자리가 필요하다 (받은 값: '$sha')"
  check_preconditions

  local prev
  prev="$(git rev-parse --verify -q HEAD || echo none)"
  keep_previous
  record "deploy-start target=$sha previous=$prev"

  run git fetch --prune origin
  run git checkout --detach "$sha"

  # 이전 migrate 컨테이너를 지워 항상 새로 돌린다. 시드·테스트 계정은 만들지 않는다 (compose에 없음)
  run docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" rm -f -s migrate
  run docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

  wait_migrate

  if ! wait_health; then
    die "web /api/health 실패 (3분)"
  fi

  record "deploy-ok current=$sha"
  log "배포 완료: $sha"
}

rollback() {
  local svc img
  if ! dry; then
    for svc in "${APP_SERVICES[@]}"; do
      img="fmerp-prod-${svc}:previous"
      docker image inspect "$img" >/dev/null 2>&1 || die "$img 이 없어 되돌릴 수 없다. 서버에서 직접 확인한다"
    done
  fi
  for svc in "${APP_SERVICES[@]}"; do
    img="fmerp-prod-${svc}"
    run docker tag "${img}:previous" "${img}:latest"
  done
  run docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-build web worker

  if ! wait_health; then
    record "rollback-health-failed"
    die "롤백 후에도 /api/health 실패. 서버에서 직접 확인한다"
  fi
  record "rollback-ok"
  log "이전 이미지로 롤백 완료 (DB 마이그레이션은 되돌리지 않았다)"
}

main() {
  case "${1:-}" in
    deploy)
      [[ $# -eq 2 ]] || die "사용: deploy <커밋 SHA>"
      deploy "$2"
      ;;
    rollback)
      rollback
      ;;
    *)
      die "사용: deploy <커밋 SHA> | rollback"
      ;;
  esac
}

main "$@"

#!/bin/bash
# Job 내부 공개 실행기. 테스트용 경로/대기값 override 외에는 격리 localhost만 사용한다.
set -Eeuo pipefail
cache_key() {
  node -e 'const fs=require("fs"),c=require("crypto"); const h=c.createHash("sha256");
    for(const f of ["pnpm-lock.yaml","pnpm-workspace.yaml"])h.update(fs.readFileSync(f));
    h.update(JSON.stringify([process.platform,process.arch,process.version,process.versions.modules,
      process.report.getReport().header.glibcVersionRuntime,require("./package.json").packageManager]));
    console.log(h.digest("hex"));'
}
if [ "${1:-}" = --cache-key ]; then cache_key; exit; fi
SRC=${RUNNER_SOURCE:-/src}
WORK=${RUNNER_WORK:-/work}
ART=${RUNNER_ARTIFACTS:-/artifacts}
WAIT=${COLLECT_WAIT_SECONDS:-300}
READY_TIMEOUT=${SERVICE_TIMEOUT_SECONDS:-120}
mkdir -p "$ART" "$WORK"
chmod 700 "$ART"
PHASE=prep
PHASE_START=$(date +%s)
METRICS_PID=
TEST_PID=
CACHE_LOCK=
CACHE_TEMP=
phase_end() {
  local now
  now=$(date +%s)
  printf '%s\t%s\t%s\n' "$PHASE" "$PHASE_START" "$now" >> "$ART/phases.tsv"
  PHASE_START=$now
}
finish() {
  local code=$?
  trap - EXIT
  set +e
  [ -z "$TEST_PID" ] || kill "$TEST_PID" 2>/dev/null
  [ -z "$CACHE_TEMP" ] || rm -rf "$CACHE_TEMP"
  [ -z "$CACHE_LOCK" ] || rmdir "$CACHE_LOCK" 2>/dev/null
  phase_end
  [ -z "$METRICS_PID" ] || { kill "$METRICS_PID" 2>/dev/null; wait "$METRICS_PID" 2>/dev/null; }
  # 앱 환경 전체를 기록하지 않고 알려진 테스트 출력만 저장한다.
  for path in test-results playwright-report apps/web/test-results apps/web/playwright-report; do
    if [ -d "$WORK/$path" ]; then
      mkdir -p "$ART/$(dirname "$path")"
      cp -a "$WORK/$path" "$ART/$path" || { [ "$code" != 0 ] || code=74; }
    fi
  done
  node - "$ART" "$code" "$PHASE" <<'JS'
const fs=require('fs'),path=require('path'); const [dir,code,failed]=process.argv.slice(2);
const phases={prep:null,install:null,services:null,test:null};
for(const line of fs.readFileSync(path.join(dir,'phases.tsv'),'utf8').trim().split('\n')) {
  const [name,start,end]=line.split('\t'); phases[name]=Number(end)-Number(start);
}
fs.writeFileSync(path.join(dir,'runner-summary.json'),JSON.stringify({exit_code:Number(code),last_phase:failed,phases},null,2)+'\n');
JS
  [ "$?" = 0 ] || { [ "$code" != 0 ] || code=74; }
  printf '%s\n' "$code" > "$ART/exit-code.tmp"
  mv "$ART/exit-code.tmp" "$ART/exit-code"
  # 호스트가 살아 있을 때 수집하고 release한 뒤 진짜 Job 종료/TTL이 시작된다.
  local until_time=$(( $(date +%s) + WAIT ))
  until [ -f "$ART/collected" ] || [ "$(date +%s)" -ge "$until_time" ]; do sleep 1; done
  exit "$code"
}
trap finish EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
# 복사 오류는 fatal이며 호스트 node_modules·환경 파일·출력은 가져오지 않는다.
tar -C "$SRC" --exclude=node_modules --exclude=.git --exclude=.worktrees \
  --exclude='.env*' --exclude=.npmrc --exclude='*.pem' --exclude='*.key' \
  --exclude=.next --exclude=.pnpm-store --exclude=artifacts --exclude=test-results \
  --exclude=playwright-report --exclude=coverage -cf - . | tar -C "$WORK" -xf -
cd "$WORK"
# 누적 cgroup 값과 프로세스 RSS를 1초 간격으로 기록한다. 단순 비율을 wall-time으로 해석하지 않는다.
node - "$ART/metrics.jsonl" <<'JS' &
const fs=require('fs'),out=process.argv[2];
function sample(){
  const row={timestamp:new Date().toISOString(),cgroup:{},processes:[]};
  for(const name of ['cpu.max','cpu.stat','memory.current','memory.peak','memory.events','memory.stat']){
    try{row.cgroup[name]=fs.readFileSync('/sys/fs/cgroup/'+name,'utf8').trim();}catch{}
  }
  try{for(const pid of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){
    try{const s=fs.readFileSync('/proc/'+pid+'/status','utf8');
      const name=(s.match(/^Name:\s+(.+)$/m)||[])[1]; const rss=(s.match(/^VmRSS:\s+(\d+)/m)||[])[1];
      if(rss)row.processes.push({pid:Number(pid),name,rss_kib:Number(rss)});
    }catch{}
  }}catch{}
  fs.appendFileSync(out,JSON.stringify(row)+'\n');
} sample();setInterval(sample,1000);
JS
METRICS_PID=$!
mkdir -p "$WORK/.runner-bin"
# 시스템 디렉터리 대신 이번 실행 전용 PATH에 pnpm shim을 만든다 (non-root 이미지 호환).
corepack enable --install-directory "$WORK/.runner-bin"
# 백업 테스트 docker exec 호환; 어떤 외부 Docker/DB에도 연결하지 않는다.
mkdir -p "$WORK/.runner-bin"
cat > "$WORK/.runner-bin/docker" <<'SHIM'
#!/bin/bash
set -euo pipefail
[ "${1:-}" = exec ] || { echo 'docker shim: exec 만 지원' >&2; exit 127; }
shift
while [ $# -gt 0 ]; do
  case "$1" in
    -i|-t|-it) shift;;
    -e) export "$2"; shift 2;;
    *) shift; break;;
  esac
done
export PGHOST=127.0.0.1 PGPORT=55433
args=(); prev=''
for a in "$@"; do
  if [ "$prev" = -p ] && [ "$a" = 5432 ]; then a=55433; fi
  if [ "$prev" = -h ] && [ "$a" = localhost ]; then a=127.0.0.1; fi
  args+=("$a"); prev="$a"
done
exec "${args[@]}"
SHIM
chmod +x "$WORK/.runner-bin/docker"
export PATH="$WORK/.runner-bin:$PATH"
pnpm pkg delete scripts.prepare
phase_end
PHASE=install
KEY=$(cache_key)
STORE=${PNPM_STORE_DIR:-/pnpm-store}
mkdir -p "$STORE"
CACHE=${RUNNER_CACHE:-}
if [ -n "$CACHE" ]; then mkdir -p "$CACHE"; fi
if [ -n "$CACHE" ] && [ -d "$CACHE/$KEY/store" ]; then
  cp -a "$CACHE/$KEY/store/." "$STORE/"
  printf 'hit %s\n' "$KEY" > "$ART/cache.txt"
else
  printf 'miss %s\n' "$KEY" > "$ART/cache.txt"
fi
# 공유 캐시는 완료된 불변 snapshot만 읽고, 각 Job은 자기 store에만 install한다.
pnpm install --frozen-lockfile --store-dir "$STORE" > "$ART/install.log" 2>&1
if [ -n "$CACHE" ] && [ ! -d "$CACHE/$KEY" ] && mkdir "$CACHE/.$KEY.lock" 2>/dev/null; then
  CACHE_LOCK="$CACHE/.$KEY.lock"
  # 존재 확인과 lock 획득 사이에 다른 Job이 게시했을 수 있다.
  if [ ! -d "$CACHE/$KEY" ]; then
    CACHE_TEMP="$CACHE/.$KEY.${HOSTNAME:-runner}.$$.tmp"
    mkdir -p "$CACHE_TEMP/store"
    cp -a "$STORE/." "$CACHE_TEMP/store/"
    mv "$CACHE_TEMP" "$CACHE/$KEY"
    CACHE_TEMP=
  fi
  rmdir "$CACHE_LOCK"
  CACHE_LOCK=
fi
phase_end
PHASE=services
# 열린 TCP 포트가 아니라 PostgreSQL SQL + S3 HTTP 응답으로 확인한다.
END=$(( $(date +%s) + READY_TIMEOUT ))
until PGPASSWORD=postgres psql -h 127.0.0.1 -p 55433 -U postgres -d fmerp -Atqc 'SELECT 1' >/dev/null 2>&1 \
  && node -e "fetch('http://127.0.0.1:58333/fmerp-test',{method:'PUT',signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok||r.status===409?0:1)).catch(()=>process.exit(1))"; do
  [ "$(date +%s)" -lt "$END" ] || { echo '격리 DB/S3 준비 제한 초과' >&2; exit 69; }
  sleep 2
done
phase_end
PHASE=test
# host는 개별 argv를 shlex.quote로 인코딩한다. stderr/stdout은 kubectl logs로 수집한다.
bash -c "$TEST_CMD" &
TEST_PID=$!
wait "$TEST_PID"
TEST_PID=

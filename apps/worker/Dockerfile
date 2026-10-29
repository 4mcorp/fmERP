# worker 이미지: 완료 PDF·패키지, 큐, 예약 작업, DB 덤프. DEPLOYMENT_PLAN 6장·TECH_SPEC 참고.
# 저장소 루트를 빌드 컨텍스트로 쓴다:  docker build -f apps/worker/Dockerfile -t fmerp-worker .
# 슬림 구성: node:24-bookworm-slim + Chromium 하나만 설치한다 (Playwright 공식 이미지는 chromium·firefox·webkit 전부라 6GB).
# 브라우저 버전은 npm의 @playwright/test(~1.63.0)가 정한다. 그래서 이미지 태그와 버전을 맞출 필요가 없다.
# DB 덤프·복원용 postgresql-client-18은 PostgreSQL 공식 APT 저장소(PGDG)에서 받는다. 덤프 암호화는 age-encryption(npm)이라 age 바이너리는 필요 없다.
FROM node:24-bookworm-slim

ENV CI=true \
    LEFTHOOK=0 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

# pg_dump·pg_restore (DB 서버와 같은 주 버전 18). PGDG 저장소 키는 공식 주소에서 받아 서명 검증에 쓴다
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-18 \
 && rm -rf /var/lib/apt/lists/*

# pnpm은 corepack으로 고정 버전을 쓴다 (package.json의 packageManager와 같게 유지)
RUN corepack enable && corepack prepare pnpm@11.28.3 --activate

# 의존성 설치는 worker와 그것이 쓰는 워크스페이스 패키지만 (lockfile 고정).
# 한 RUN 안에서 설치 → Chromium(+시스템 라이브러리, 한글 폴백 글꼴) → 스토어 삭제 → 소유권 변경까지 끝낸다 (레이어에 중복이 남지 않게).
# 루트 prepare(lefthook install)는 .git이 없는 이미지에서 실패하므로 이 복사본에서만 제거한다
COPY . .
RUN pnpm pkg delete scripts.prepare \
 && pnpm install --frozen-lockfile --filter @fmerp/worker... \
 && cd features/completion && pnpm exec playwright install --with-deps --only-shell chromium \
 && apt-get install -y --no-install-recommends fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/* "$(pnpm store path)" \
 && chown -R node:node /app /ms-playwright

# PDF 글꼴: apps/worker/fonts/*.woff2(Pretendard 등)를 쓰고, 없으면 시스템 글꼴(Noto CJK)로 대체한다
ENV FONT_DIR=/app/apps/worker/fonts

USER node

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.WORKER_PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/apps/worker
CMD ["pnpm", "start"]

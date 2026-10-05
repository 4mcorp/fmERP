# web 이미지 (초안): Next.js UI + Hono API. DEPLOYMENT_PLAN 6장 참고.
# 저장소 루트를 빌드 컨텍스트로 쓴다:  docker build -f apps/web/Dockerfile --target runner -t fmerp-web .
# 같은 Dockerfile의 builder 단계는 마이그레이션·시드 같은 1회성 작업(migrate)에도 쓴다.
FROM node:24-bookworm-slim AS builder

ENV CI=true \
    LEFTHOOK=0 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# pnpm은 corepack으로 고정 버전을 쓴다 (package.json의 packageManager와 같게 유지)
RUN corepack enable && corepack prepare pnpm@11.28.3 --activate

COPY . .
# 루트 prepare(lefthook install)는 .git이 없는 이미지에서 실패하므로 이 복사본에서만 제거한다
RUN pnpm pkg delete scripts.prepare && pnpm install --frozen-lockfile --filter @fmerp/web...
# 빌드에는 운영 환경 변수가 필요 없다 (서버가 첫 요청에서 검증한다)
RUN pnpm --filter @fmerp/web build

FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
# standalone 산출물은 저장소 루트를 기준으로 추적되어 apps/web/server.js에 있다
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

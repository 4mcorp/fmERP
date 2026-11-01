import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// 모노레포 루트의 .env를 읽는다 (Next 기본값은 apps/web 폴더).
// Next가 이미 apps/web 기준으로 env를 읽어 캐시했으므로 forceReload(4번째 인자)가 없으면 무시된다.
const repoRoot = path.resolve(process.cwd(), "../..");
loadEnvConfig(repoRoot, process.env.NODE_ENV !== "production", undefined, true);

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // sandbox=""인 양식 srcdoc도 공개 글꼴을 읽는다. 앱/API에는 CORS를 열지 않는다.
  headers: () => [
    {
      source: "/fonts/:file*",
      headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
    },
  ],
  transpilePackages: [
    "@fmerp/audit",
    "@fmerp/db",
    "@fmerp/feature-account",
    "@fmerp/feature-approval",
    "@fmerp/feature-audit",
    "@fmerp/feature-backup",
    "@fmerp/feature-completion",
    "@fmerp/feature-home",
    "@fmerp/feature-notification",
    "@fmerp/feature-org",
    "@fmerp/shared",
    "@fmerp/storage",
  ],
};

export default nextConfig;

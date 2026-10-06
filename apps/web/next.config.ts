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
  transpilePackages: [
    "@fmerp/audit",
    "@fmerp/auth",
    "@fmerp/core",
    "@fmerp/db",
    "@fmerp/notification",
    "@fmerp/shared",
    "@fmerp/storage",
  ],
};

export default nextConfig;

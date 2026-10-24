import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getServerDeps } from "@/server/deps";

/** 로그인한 사용자만 들어온다. 유휴·절대 만료는 API 미들웨어가 판단한다 (AUTH-008) */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // headers()를 먼저 호출해 요청 시점 렌더링으로 만든다. 그래야 빌드 중에 서버 의존성(DB·환경 변수)을 만들지 않는다
  const requestHeaders = await headers();
  const deps = getServerDeps();
  const session = await deps.auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login");
  return <AppShell>{children}</AppShell>;
}

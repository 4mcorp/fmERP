// 통합 테스트 전용 헬퍼. 앱 코드에서 import하지 않는다.
/** 요청을 받는 앱 (Hono 앱의 `request`만 쓴다). 합성 루트의 시험 설정(apps/web/server/test-support.ts)이 주입한다 */
export interface TestApp {
  request: (path: string, init?: RequestInit) => Response | Promise<Response>;
}

let app: TestApp | null = null;

export function setTestApp(target: TestApp): void {
  app = target;
}

function target(): TestApp {
  if (!app)
    throw new Error(
      "시험 앱이 주입되지 않았습니다 (vitest setupFiles: apps/web/server/test-support.ts)",
    );
  return app;
}

const ORIGIN = "http://localhost:3000";

export interface TestClient {
  cookie: string;
  request: (
    path: string,
    init?: { method?: string; body?: unknown; headers?: Record<string, string> },
  ) => Promise<Response>;
}

/** 시드 테스트 계정으로 로그인한 클라이언트 (POST /api/dev/login) */
export async function loginAs(email: string): Promise<TestClient> {
  const res = await target().request("/api/dev/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email }),
  });
  if (res.status !== 200) {
    throw new Error(`테스트 로그인 실패 ${email}: ${res.status} ${await res.text()}`);
  }
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return clientWithCookie(cookie);
}

export function clientWithCookie(cookie: string): TestClient {
  return {
    cookie,
    request: async (path, init = {}) =>
      target().request(path, {
        method: init.method ?? "GET",
        headers: {
          cookie,
          origin: ORIGIN,
          "content-type": "application/json",
          ...init.headers,
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
  };
}

export async function json<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

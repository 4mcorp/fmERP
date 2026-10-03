/** 브라우저에서 /api를 호출한다. 오류는 RFC 9457 응답을 ApiProblem으로 바꾼다 (ADR 0003). */
export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    title: string,
    readonly detail?: string,
  ) {
    super(title);
  }
}

const LOGIN_REQUIRED = new Set(["unauthenticated", "idle_expired", "absolute_expired"]);

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      code?: string;
      title?: string;
      detail?: string;
    };
    const code = body.code ?? "error";
    if (res.status === 401 && LOGIN_REQUIRED.has(code) && typeof window !== "undefined") {
      window.location.href = `/dev-login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiProblem(res.status, code, body.title ?? "요청을 처리하지 못했습니다", body.detail);
  }
  return (await res.json()) as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiProblem)
    return error.detail ? `${error.message} (${error.detail})` : error.message;
  return "요청을 처리하지 못했습니다";
}

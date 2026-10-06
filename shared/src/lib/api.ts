/** 브라우저에서 /api를 호출한다. 오류는 RFC 9457 응답을 ApiProblem으로 바꾼다 (ADR 0003). */
export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    title: string,
    readonly detail?: string,
    /** 업무 오류의 부가 정보 (예: 뎁스를 넘는 부서 목록, CSV 오류 줄) */
    readonly extensions?: Record<string, unknown>,
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
      extensions?: Record<string, unknown>;
    };
    const code = body.code ?? "error";
    if (res.status === 401 && LOGIN_REQUIRED.has(code) && typeof window !== "undefined") {
      window.location.href = `/dev-login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiProblem(
      res.status,
      code,
      body.title ?? "요청을 처리하지 못했습니다",
      body.detail,
      body.extensions,
    );
  }
  return (await res.json()) as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiProblem)
    return error.detail ? `${error.message} (${error.detail})` : error.message;
  return "요청을 처리하지 못했습니다";
}

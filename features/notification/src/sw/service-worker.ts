// 4mERP 서비스 워커 원문. 제공은 apps/web/app/sw.js/route.ts가 맡는다 (정적 파일 대신 라우트: knip이 public 파일을 미사용으로 보는 문제 회피).
// 이 문자열을 바꿀 때는 features/notification/tests/service-worker.test.ts도 함께 본다.
const SERVICE_WORKER_SOURCE = `
// 4mERP 서비스 워커.
// - 웹 푸시: 알림을 표시한다. 문구는 서버가 외부 채널용으로 만든 값만 담는다 (문서 제목·내용 없음).
// - 알림 클릭: 같은 출처의 상대 경로(path)만 연다. 외부 주소로 보내지 않는다.
// - 캐시: 정적 자산(/_next/static, /icons)에 한정한다. API·인증·문서 응답은 캐시하지 않는다.

const STATIC_CACHE = "4merp-static-v1";
const STATIC_PREFIXES = ["/_next/static/", "/icons/"];

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("4merp-static-") && k !== STATIC_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!STATIC_PREFIXES.some((p) => url.pathname.startsWith(p))) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === "basic") await cache.put(req, res.clone());
      return res;
    })(),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "4mERP";
  const body = typeof data.body === "string" ? data.body : "";
  const path = safePath(data.path);
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: path,
      data: { path },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data?.path);
  event.waitUntil(
    (async () => {
      const target = new URL(path, self.location.origin).href;
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// 같은 출처의 절대 경로만 받는다. "//"로 시작하거나 다른 출처를 가리키면 "/"로 바꾼다
function safePath(value) {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
`;

/** `/sw.js` 응답. 범위는 앱 전체(`/`), 갱신을 막는 캐시는 두지 않는다 (브라우저가 바뀐 워커를 바로 받는다) */
export function serviceWorkerResponse(): Response {
  return new Response(SERVICE_WORKER_SOURCE, {
    status: 200,
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
      "Cache-Control": "no-cache",
    },
  });
}

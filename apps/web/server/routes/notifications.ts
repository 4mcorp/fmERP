import { withTenant } from "@fmerp/db";
import type { SystemGuards } from "@fmerp/shared/contracts/system-guards";
import { errorResponses, json, OkSchema } from "@fmerp/shared/server/common";
import {
  type AppRouter,
  type DepsProvider,
  requireSession,
  requireTenant,
} from "@fmerp/shared/server/http";
import { createRoute, z } from "@hono/zod-openapi";
import {
  listNotifications,
  markAllRead,
  markRead,
  myMembershipId,
  unreadCount,
} from "../notifications/service";
import {
  changeReceiverMode,
  createMyLink,
  getMyTelegram,
  getSystemTelegram,
  handleWebhook,
  unlinkMyTelegram,
} from "../notifications/telegram";

const ItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  documentId: z.string().nullable(),
  href: z.string(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});

const WebhookUpdate = z.object({
  update_id: z.number(),
  message: z
    .object({
      text: z.string().max(4096).optional(),
      chat: z.object({ id: z.number(), type: z.string() }),
      from: z.object({ id: z.number(), is_bot: z.boolean().optional() }).optional(),
    })
    .optional(),
});

/**
 * 알림 (PRD NTF-001·002, M8 plan): 인앱 알림 조회·읽음, 텔레그램 연결, 웹훅 수신, 수신 방식 설정.
 * 인앱 알림은 본인 것만 다루고, 텔레그램 연결과 수신 방식은 계정과 무관해 세션만 확인한다.
 */
/** `guards`(시스템 관리자 확인·PIN 재인증)는 백업 기능이 제공하고 합성 루트가 주입한다 */
export function registerNotificationRoutes(
  app: AppRouter,
  deps: DepsProvider,
  guards: SystemGuards,
) {
  const { requireStrictReauth, requireSystemAdmin } = guards;
  app.use("/notifications", requireSession(deps), requireTenant(deps));
  app.use("/notifications/*", requireSession(deps), requireTenant(deps));
  app.use("/me/telegram", requireSession(deps));
  app.use("/me/telegram/*", requireSession(deps));
  app.use("/system/telegram", requireSession(deps));
  app.use("/system/telegram/*", requireSession(deps));

  app.openapi(
    createRoute({
      method: "get",
      path: "/notifications",
      tags: ["notification"],
      summary: "내 알림 목록 (최신순, 커서 페이지네이션)",
      request: {
        query: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(30),
          cursor: z.uuid().optional(),
          unread: z.stringbool().default(false),
        }),
      },
      responses: {
        200: json(z.object({ items: z.array(ItemSchema), nextCursor: z.string().nullable() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const { limit, cursor, unread } = c.req.valid("query");
      const page = await withTenant(d.appDb, c.get("tenant").accountId, async (tx) =>
        listNotifications(tx, await myMembershipId(tx, c.get("session").userId), {
          limit,
          cursor,
          unreadOnly: unread,
        }),
      );
      return c.json(page, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/notifications/unread-count",
      tags: ["notification"],
      summary: "읽지 않은 알림 수 (헤더 배지)",
      responses: { 200: json(z.object({ count: z.number() })), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const count = await withTenant(d.appDb, c.get("tenant").accountId, async (tx) =>
        unreadCount(tx, await myMembershipId(tx, c.get("session").userId)),
      );
      return c.json({ count }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/notifications/read-all",
      tags: ["notification"],
      summary: "모든 알림을 읽음으로 표시",
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      await withTenant(d.appDb, c.get("tenant").accountId, async (tx) =>
        markAllRead(tx, await myMembershipId(tx, c.get("session").userId), d.now()),
      );
      return c.json({ ok: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/notifications/{id}/read",
      tags: ["notification"],
      summary: "알림 하나를 읽음으로 표시 (남의 알림은 404)",
      request: { params: z.object({ id: z.uuid() }) },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const { id } = c.req.valid("param");
      await withTenant(d.appDb, c.get("tenant").accountId, async (tx) =>
        markRead(tx, await myMembershipId(tx, c.get("session").userId), id, d.now()),
      );
      return c.json({ ok: true as const }, 200);
    },
  );

  // ---- 텔레그램 연결 (내 정보) ----
  app.openapi(
    createRoute({
      method: "get",
      path: "/me/telegram",
      tags: ["notification"],
      summary: "내 텔레그램 연결 상태 (enabled: 서버에 봇이 설정되어 있는지)",
      responses: {
        200: json(z.object({ enabled: z.boolean(), linked: z.boolean() })),
        ...errorResponses,
      },
    }),
    async (c) => c.json(await getMyTelegram(deps(), c.get("session").userId), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/me/telegram/link",
      tags: ["notification"],
      summary: "텔레그램 연결 링크 만들기 (10분·1회용 토큰이 든 t.me 주소)",
      responses: {
        200: json(z.object({ url: z.string(), expiresAt: z.string() })),
        ...errorResponses,
      },
    }),
    async (c) => c.json(await createMyLink(deps(), c.get("session"), c.get("request")), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/me/telegram/unlink",
      tags: ["notification"],
      summary: "텔레그램 연결 해제",
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      await unlinkMyTelegram(deps(), c.get("session"), c.get("request"));
      return c.json({ ok: true as const }, 200);
    },
  );

  // ---- 수신 방식 (시스템 관리자) ----
  app.openapi(
    createRoute({
      method: "get",
      path: "/system/telegram",
      tags: ["system"],
      summary: "텔레그램 수신 방식과 상태 (시스템 관리자)",
      responses: { 200: json(z.object({}).passthrough()), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      await requireSystemAdmin(d, c.get("session"));
      return c.json((await getSystemTelegram(d)) as never, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/system/telegram/mode",
      tags: ["system"],
      summary: "텔레그램 수신 방식 변경 (시스템 관리자, PIN 재인증). worker가 30초 안에 적용한다",
      request: {
        body: {
          content: {
            "application/json": { schema: z.object({ mode: z.enum(["polling", "webhook"]) }) },
          },
        },
      },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const session = c.get("session");
      await requireSystemAdmin(d, session);
      await requireStrictReauth(d, session);
      await changeReceiverMode(d, session, c.req.valid("json").mode, c.get("request"));
      return c.json({ ok: true as const }, 200);
    },
  );

  // ---- 웹훅 수신: 세션 없이 비밀 헤더로만 인증한다 ----
  app.openapi(
    createRoute({
      method: "post",
      path: "/telegram/webhook",
      tags: ["notification"],
      summary: "텔레그램 웹훅 (비밀 헤더 X-Telegram-Bot-Api-Secret-Token으로 인증)",
      request: { body: { content: { "application/json": { schema: WebhookUpdate } } } },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      await handleWebhook(
        deps(),
        c.req.header("x-telegram-bot-api-secret-token"),
        c.req.valid("json"),
      );
      return c.json({ ok: true as const }, 200);
    },
  );
}

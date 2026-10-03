import { randomUUID } from "node:crypto";
import {
  getProfile,
  hasApprovalPin,
  listLoginHistory,
  listMyAccounts,
  listMySessions,
  revokeMySession,
  setApprovalPin,
  updateProfile,
  verifyApprovalPin,
} from "@fmerp/auth";
import { createRoute, z } from "@hono/zod-openapi";
import { ApiError, type AppRouter, type DepsProvider, requireSession } from "../http";
import { errorResponses, json, OkSchema } from "./common";

const IMAGE_KINDS = ["signature", "stamp"] as const;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const MeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    hasSignature: z.boolean(),
    hasStamp: z.boolean(),
    hasPin: z.boolean(),
    activeAccountId: z.string().nullable(),
    accounts: z.array(
      z.object({ accountId: z.string(), name: z.string(), role: z.string(), status: z.string() }),
    ),
    devTestLogin: z.boolean(),
  })
  .openapi("Me");

export function registerMeRoutes(app: AppRouter, deps: DepsProvider) {
  app.use("/me", requireSession(deps));
  app.use("/me/*", requireSession(deps));

  app.openapi(
    createRoute({
      method: "get",
      path: "/me",
      tags: ["me"],
      summary: "내 정보와 소속 회사",
      responses: { 200: json(MeSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const session = c.get("session");
      const profile = await getProfile(d.authDb, session.userId);
      if (!profile) throw new ApiError(401, "unauthenticated", "로그인이 필요합니다");
      return c.json(
        {
          id: profile.id,
          name: profile.name,
          email: profile.email,
          hasSignature: Boolean(profile.signatureKey),
          hasStamp: Boolean(profile.stampKey),
          hasPin: await hasApprovalPin(d.authDb, session.userId),
          activeAccountId: session.activeAccountId,
          accounts: await listMyAccounts(d.authDb, session.userId),
          devTestLogin: d.devTestLogin,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/me",
      tags: ["me"],
      summary: "프로필 수정 (PRD AUTH-016)",
      request: {
        body: {
          content: {
            "application/json": { schema: z.object({ name: z.string().trim().min(1).max(50) }) },
          },
        },
      },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      await updateProfile(deps().authDb, {
        userId: c.get("session").userId,
        patch: { name: c.req.valid("json").name },
        request: c.get("request"),
      });
      return c.json({ ok: true as const }, 200);
    },
  );

  // ===== 서명·도장 이미지 (PRD AUTH-016). 브라우저가 서명 URL로 저장소에 직접 올린다 =====
  const kindParam = z.object({ kind: z.enum(IMAGE_KINDS) });
  const keyPrefix = (userId: string, kind: string) => `users/${userId}/${kind}/`;

  app.openapi(
    createRoute({
      method: "post",
      path: "/me/images/{kind}/upload-url",
      tags: ["me"],
      summary: "서명·도장 이미지 업로드용 서명 URL 발급",
      request: {
        params: kindParam,
        body: {
          content: {
            "application/json": { schema: z.object({ contentType: z.enum(IMAGE_TYPES) }) },
          },
        },
      },
      responses: {
        200: json(z.object({ uploadUrl: z.string(), key: z.string() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { kind } = c.req.valid("param");
      const { contentType } = c.req.valid("json");
      const key = `${keyPrefix(c.get("session").userId, kind)}${randomUUID()}`;
      const uploadUrl = await deps().storage.presignPut(key, contentType);
      return c.json({ uploadUrl, key }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/me/images/{kind}",
      tags: ["me"],
      summary: "업로드한 이미지를 서명·도장으로 등록",
      request: {
        params: kindParam,
        body: { content: { "application/json": { schema: z.object({ key: z.string() }) } } },
      },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const { kind } = c.req.valid("param");
      const { key } = c.req.valid("json");
      const userId = c.get("session").userId;
      if (!key.startsWith(keyPrefix(userId, kind))) {
        throw new ApiError(403, "forbidden", "본인 이미지만 등록할 수 있습니다");
      }
      const info = await d.storage.head(key);
      if (!info) throw new ApiError(400, "validation_error", "업로드된 파일이 없습니다");
      if (!IMAGE_TYPES.includes(info.contentType as (typeof IMAGE_TYPES)[number])) {
        throw new ApiError(400, "validation_error", "PNG·JPEG·WebP 이미지만 등록할 수 있습니다");
      }
      if (info.size > MAX_IMAGE_BYTES) {
        throw new ApiError(400, "validation_error", "이미지는 2MB 이하여야 합니다");
      }
      await updateProfile(d.authDb, {
        userId,
        patch: kind === "signature" ? { signatureKey: key } : { stampKey: key },
        request: c.get("request"),
      });
      return c.json({ ok: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/me/images/{kind}",
      tags: ["me"],
      summary: "서명·도장 이미지 보기용 서명 URL",
      request: { params: kindParam },
      responses: { 200: json(z.object({ url: z.string() })), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const { kind } = c.req.valid("param");
      const profile = await getProfile(d.authDb, c.get("session").userId);
      const key = kind === "signature" ? profile?.signatureKey : profile?.stampKey;
      if (!key) throw new ApiError(404, "not_found", "등록된 이미지가 없습니다");
      return c.json({ url: await d.storage.presignGet(key) }, 200);
    },
  );

  // ===== 세션 (PRD AUTH-008) =====
  const SessionSchema = z
    .object({
      id: z.string(),
      ipAddress: z.string().nullable(),
      userAgent: z.string().nullable(),
      createdAt: z.string(),
      lastActiveAt: z.string(),
      current: z.boolean(),
    })
    .openapi("Session");

  app.openapi(
    createRoute({
      method: "get",
      path: "/me/sessions",
      tags: ["me"],
      summary: "내 활성 세션",
      responses: { 200: json(z.array(SessionSchema)), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const session = c.get("session");
      const rows = await listMySessions(d.authDb, session.userId, d.now());
      return c.json(
        rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          lastActiveAt: r.lastActiveAt.toISOString(),
          current: r.id === session.sessionId,
        })),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/me/sessions/{id}",
      tags: ["me"],
      summary: "세션 강제 종료",
      request: { params: z.object({ id: z.uuid() }) },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const revoked = await revokeMySession(deps().authDb, {
        userId: c.get("session").userId,
        sessionId: c.req.valid("param").id,
        request: c.get("request"),
      });
      if (!revoked) throw new ApiError(404, "not_found", "세션이 없습니다");
      return c.json({ ok: true as const }, 200);
    },
  );

  // ===== 로그인 이력 (PRD AUTH-013) =====
  app.openapi(
    createRoute({
      method: "get",
      path: "/me/login-history",
      tags: ["me"],
      summary: "내 로그인 이력 (최근 50건)",
      responses: {
        200: json(
          z.array(
            z.object({
              occurredAt: z.string(),
              action: z.string(),
              result: z.string(),
              ip: z.string().nullable(),
              userAgent: z.string().nullable(),
              reason: z.string().nullable(),
            }),
          ),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const rows = await listLoginHistory(deps().authDb, c.get("session").userId);
      return c.json(
        rows.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() })),
        200,
      );
    },
  );

  // ===== 결재 PIN (PRD AUTH-009) =====
  app.openapi(
    createRoute({
      method: "put",
      path: "/me/pin",
      tags: ["me"],
      summary: "결재 PIN 설정·변경",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({ pin: z.string(), currentPin: z.string().optional() }),
            },
          },
        },
      },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const body = c.req.valid("json");
      await setApprovalPin(d.authDb, {
        userId: c.get("session").userId,
        pin: body.pin,
        currentPin: body.currentPin,
        now: d.now(),
        request: c.get("request"),
      });
      return c.json({ ok: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/me/pin/verify",
      tags: ["me"],
      summary: "결재 PIN 확인 (성공 시 30분간 재인증 생략)",
      request: {
        body: { content: { "application/json": { schema: z.object({ pin: z.string() }) } } },
      },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const session = c.get("session");
      await verifyApprovalPin(d.authDb, {
        userId: session.userId,
        sessionId: session.sessionId,
        pin: c.req.valid("json").pin,
        now: d.now(),
        request: c.get("request"),
      });
      return c.json({ ok: true as const }, 200);
    },
  );
}

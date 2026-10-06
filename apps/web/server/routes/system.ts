import { requireStrictReauth } from "@fmerp/shared/authz/reauth";
import { errorResponses, json, OkSchema } from "@fmerp/shared/server/common";
import { type AppRouter, type DepsProvider, requireSession } from "@fmerp/shared/server/http";
import { createRoute, z } from "@hono/zod-openapi";
import {
  backupDownloadUrl,
  isSystemAdminUser,
  listBackups,
  requestBackupDeletion,
  requestManualDump,
  requireSystemAdmin,
} from "../system/backups";

const idParam = z.object({ id: z.uuid() });

const BackupItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["auto", "manual"]),
  status: z.string(),
  note: z.string().nullable(),
  requestedByName: z.string().nullable(),
  requestedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  size: z.number().nullable(),
  sha256: z.string().nullable(),
  pgDumpVersion: z.string().nullable(),
  error: z.string().nullable(),
  deleteRequestedAt: z.string().nullable(),
  downloads: z.array(z.object({ at: z.string(), userName: z.string().nullable() })),
});

/**
 * 시스템 관리: DB 덤프 이력·수동 덤프·다운로드·삭제 요청 (PRD BAK-005~007, M7 plan 1절).
 * 모든 계정의 데이터가 담기므로 환경 변수로 지정한 시스템 관리자만 쓸 수 있고, 아니면 존재를 알리지 않는다(404).
 * 계정(테넌트) 컨텍스트가 필요 없어 세션만 확인한다.
 */
export function registerSystemRoutes(app: AppRouter, deps: DepsProvider) {
  app.use("/system", requireSession(deps));
  app.use("/system/*", requireSession(deps));

  app.openapi(
    createRoute({
      method: "get",
      path: "/system/me",
      tags: ["system"],
      summary: "내가 시스템 관리자인지 (메뉴 노출용. 아니어도 200)",
      responses: { 200: json(z.object({ systemAdmin: z.boolean() })), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      return c.json({ systemAdmin: await isSystemAdminUser(d, c.get("session").userId) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/system/backups",
      tags: ["system"],
      summary: "DB 덤프 이력과 백업 상태 (시스템 관리자)",
      responses: {
        200: json(
          z.object({
            health: z.object({
              state: z.enum(["ok", "overdue"]),
              lastSuccessAt: z.string().nullable(),
              expectedBy: z.string(),
            }),
            items: z.array(BackupItemSchema),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      await requireSystemAdmin(d, c.get("session"));
      return c.json((await listBackups(d)) as never, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/system/backups",
      tags: ["system"],
      summary: "수동 덤프 요청 (시스템 관리자, PIN 재인증). worker가 곧 실행한다",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({ note: z.string().trim().max(200).optional() }),
            },
          },
        },
      },
      responses: { 201: json(z.object({ id: z.string() })), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const session = c.get("session");
      await requireSystemAdmin(d, session);
      await requireStrictReauth(d, session);
      const { note } = c.req.valid("json");
      return c.json(await requestManualDump(d, session, note, c.get("request")), 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/system/backups/{id}/download",
      tags: ["system"],
      summary: "암호화된 덤프 파일의 내려받기 URL (시스템 관리자, PIN 재인증, 감사 로그, 10분)",
      request: { params: idParam },
      responses: {
        200: json(
          z.object({ url: z.string(), filename: z.string(), expiresInSeconds: z.number() }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const session = c.get("session");
      await requireSystemAdmin(d, session);
      await requireStrictReauth(d, session);
      const { id } = c.req.valid("param");
      return c.json(await backupDownloadUrl(d, session, id, c.get("request")), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/system/backups/{id}/delete",
      tags: ["system"],
      summary:
        "수동 덤프 삭제 요청 (태그 표시, 실제 삭제는 버킷 수명 주기 규칙) (시스템 관리자, PIN 재인증)",
      request: { params: idParam },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const session = c.get("session");
      await requireSystemAdmin(d, session);
      await requireStrictReauth(d, session);
      const { id } = c.req.valid("param");
      return c.json(await requestBackupDeletion(d, session, id, c.get("request")), 200);
    },
  );
}

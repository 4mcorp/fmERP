import { hasApprovalPin } from "@fmerp/auth";
import { type ApprovalAction, can, isPinReauthFresh } from "@fmerp/core";
import { schema, withTenant } from "@fmerp/db";
import { createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import {
  attachmentUrl,
  listAttachments,
  registerAttachment,
  removeAttachment,
  requestUpload,
} from "../approval/attachments";
import { addComment, listComments } from "../approval/comments";
import { loadBody, saveDraft } from "../approval/drafts";
import { ApprovalError } from "../approval/errors";
import { listMyDocuments, listPending } from "../approval/inbox";
import { changeLine } from "../approval/line-change";
import {
  actOnStep,
  isParticipant,
  redraftDocument,
  reopenDocument,
  submitDocument,
  withdrawDocument,
} from "../approval/service";
import {
  ApiError,
  type AppRouter,
  type DepsProvider,
  requireSession,
  requireTenant,
} from "../http";
import { businessTarget, loadActor } from "../org-access";
import { LineItem } from "./approvals";
import { errorResponses, json, OkSchema } from "./common";
import { serviceContext } from "./service-context";

const Comment = z.string().trim().max(2000);

const ActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("approve") }),
  z.object({ kind: z.literal("reject"), comment: Comment }),
  z.object({ kind: z.literal("hold"), comment: Comment.optional() }),
  z.object({ kind: z.literal("release") }),
  z.object({ kind: z.literal("finalize") }),
  z.object({ kind: z.literal("agree"), comment: Comment.optional() }),
  z.object({ kind: z.literal("disagree"), comment: Comment }),
  z.object({ kind: z.literal("audit_approve"), comment: Comment.optional() }),
  z.object({ kind: z.literal("audit_reject"), comment: Comment }),
  z.object({ kind: z.literal("audit_comment"), comment: Comment }),
  z.object({ kind: z.literal("post_approve"), comment: Comment.optional() }),
]);

const idParam = z.object({ id: z.uuid() });

/** 기안 저장·상신·처리·의견·결재선 변경·첨부·받은함 (PRD APV-010~017·019·037·040~043, FILE-004) */
export function registerDocumentRoutes(app: AppRouter, deps: DepsProvider) {
  app.use("/inbox", requireSession(deps), requireTenant(deps));
  app.use("/inbox/*", requireSession(deps), requireTenant(deps));

  /**
   * 결재 처리 재인증 (AUTH-009, APV-043): 세션의 PIN 확인 시각이 30분 안이어야 한다.
   * 계정 정책 `pinRequired=false`이면 생략한다. PIN이 없으면 먼저 설정하도록 안내한다.
   */
  async function requireReauth(
    accountId: string,
    session: { userId: string; pinVerifiedAt: Date | null },
  ) {
    const d = deps();
    const [account] = await withTenant(d.appDb, accountId, (tx) =>
      tx.select({ policy: schema.account.securityPolicy }).from(schema.account),
    );
    if (account?.policy.pinRequired === false) return;
    if (!(await hasApprovalPin(d.authDb, session.userId))) {
      throw new ApiError(428, "pin_not_set", "결재 PIN을 먼저 설정하세요");
    }
    if (!isPinReauthFresh(session.pinVerifiedAt, d.now())) {
      throw new ApiError(428, "reauth_required", "결재 PIN을 입력하세요");
    }
  }

  // ===== 임시저장·본문 =====
  app.openapi(
    createRoute({
      method: "put",
      path: "/approvals/{id}/draft",
      tags: ["approval"],
      summary: "임시저장 (수동·30초 자동). 본문은 새 리비전으로 저장된다",
      request: {
        params: idParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                title: z.string().trim().min(1).max(200).optional(),
                body: z.record(z.string(), z.unknown()).optional(),
                securityLevel: z.enum(["normal", "confidential", "secret"]).optional(),
                urgent: z.boolean().optional(),
                desiredDueDate: z.iso.date().nullable().optional(),
                expectedRevision: z.number().int().min(0).optional(),
              }),
            },
          },
        },
      },
      responses: { 200: json(z.object({ revision: z.number().int() })), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return saveDraft(serviceContext(c, d, tx), {
          documentId: id,
          actorMembershipId: membershipId,
          ...body,
        });
      });
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/approvals/{id}/body",
      tags: ["approval"],
      summary: "문서 본문 (기안자·결재선 참여자). 저장된 SHA-256과 다르면 오류",
      request: {
        params: idParam,
        query: z.object({ n: z.coerce.number().int().min(1).optional() }),
      },
      responses: {
        200: json(
          z.object({ revision: z.number().int(), body: z.record(z.string(), z.unknown()) }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const { n } = c.req.valid("query");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        const ctx = serviceContext(c, d, tx);
        if (!(await isParticipant(ctx, id, membershipId))) {
          throw new ApprovalError("not_found", "문서를 찾을 수 없습니다");
        }
        return (await loadBody(ctx, id, n)) ?? { revision: 0, body: {} };
      });
      return c.json(result, 200);
    },
  );

  // ===== 상신·회수·재기안 =====
  for (const [path, run, summary] of [
    ["submit", submitDocument, "상신 (양식 검증·내용 해시 기록)"],
    ["withdraw", withdrawDocument, "회수 (첫 처리 전)"],
    ["reopen", reopenDocument, "회수한 문서를 초안으로 되돌려 수정"],
  ] as const) {
    app.openapi(
      createRoute({
        method: "post",
        path: `/approvals/{id}/${path}`,
        tags: ["approval"],
        summary,
        request: { params: idParam },
        responses: {
          200: json(z.object({ status: z.string(), docNo: z.string().nullable() })),
          ...errorResponses,
        },
      }),
      async (c) => {
        const d = deps();
        const tenant = c.get("tenant");
        const { id } = c.req.valid("param");
        const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
          const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
          return run(serviceContext(c, d, tx), id, membershipId);
        });
        return c.json({ status: result.doc.status, docNo: result.docNo ?? null }, 200);
      },
    );
  }

  app.openapi(
    createRoute({
      method: "post",
      path: "/approvals/{id}/redraft",
      tags: ["approval"],
      summary: "반려 문서 재기안: 본문·첨부를 복사한 새 초안을 원문과 연결해 만든다",
      request: { params: idParam },
      responses: {
        201: json(z.object({ documentId: z.string(), supersedes: z.string() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return redraftDocument(serviceContext(c, d, tx), id, membershipId);
      });
      return c.json(result, 201);
    },
  );

  // ===== 결재 처리 (FU-11: 세션에서 처리자 도출, 결재 관리자는 서버가 판정, 재인증) =====
  app.openapi(
    createRoute({
      method: "post",
      path: "/approvals/{id}/steps/{stepId}/act",
      tags: ["approval"],
      summary:
        "결재 처리 (승인·반려·보류·해제·전결·동의·감사·후결). 멱등 키 필수, PIN 재인증 필요(428)",
      request: {
        params: z.object({ id: z.uuid(), stepId: z.uuid() }),
        body: {
          content: {
            "application/json": {
              schema: z.object({
                action: ActionSchema,
                idempotencyKey: z.string().min(8).max(100),
                expectedVersion: z.number().int().min(0).optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: json(
          z.object({ status: z.string(), docNo: z.string().nullable(), replayed: z.boolean() }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const session = c.get("session");
      const { id, stepId } = c.req.valid("param");
      const body = c.req.valid("json");
      await requireReauth(tenant.accountId, session);
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor, membershipId } = await loadActor(tx, tenant, session.userId);
        const [doc] = await tx
          .select({ businessId: schema.document.businessId })
          .from(schema.document)
          .where(eq(schema.document.id, id));
        const ctx = serviceContext(c, d, tx);
        // 참여자가 아니면 문서가 있는지도 알려 주지 않는다 (결재 관리자도 처리자는 아니다)
        const admin = doc ? can(actor, "approval.manage", businessTarget(doc.businessId)) : false;
        if (!doc || (!admin && !(await isParticipant(ctx, id, membershipId)))) {
          throw new ApprovalError("not_found", "문서를 찾을 수 없습니다");
        }
        return actOnStep(
          ctx,
          id,
          stepId,
          body.action as ApprovalAction,
          { membershipId, isApprovalAdmin: admin },
          { idempotencyKey: body.idempotencyKey, expectedVersion: body.expectedVersion },
        );
      });
      return c.json(
        { status: result.doc.status, docNo: result.docNo ?? null, replayed: result.replayed },
        200,
      );
    },
  );

  // ===== 의견 (APV-042) =====
  app.openapi(
    createRoute({
      method: "post",
      path: "/approvals/{id}/comments",
      tags: ["approval"],
      summary: "의견 추가 (공개 범위: 결재선 전체 / 기안자만)",
      request: {
        params: idParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                body: z.string().min(1).max(2000),
                visibility: z.enum(["all", "drafter"]).default("all"),
                stepId: z.uuid().optional(),
              }),
            },
          },
        },
      },
      responses: { 201: json(z.object({ id: z.string() })), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return addComment(serviceContext(c, d, tx), {
          documentId: id,
          authorMembershipId: membershipId,
          ...body,
        });
      });
      return c.json(result, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/approvals/{id}/comments",
      tags: ["approval"],
      summary: "의견 목록 (보는 사람에게 공개된 것만)",
      request: { params: idParam },
      responses: {
        200: json(
          z.array(
            z.object({
              id: z.string(),
              stepId: z.string().nullable(),
              authorName: z.string(),
              body: z.string(),
              visibility: z.string(),
              createdAt: z.string(),
            }),
          ),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const rows = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return listComments(serviceContext(c, d, tx), id, membershipId);
      });
      return c.json(
        rows.map((r) => ({
          id: r.id,
          stepId: r.stepId,
          authorName: r.authorName,
          body: r.body,
          visibility: r.visibility,
          createdAt: r.createdAt.toISOString(),
        })),
        200,
      );
    },
  );

  // ===== 진행 중 결재선 변경 (APV-037) =====
  app.openapi(
    createRoute({
      method: "put",
      path: "/approvals/{id}/line",
      tags: ["approval"],
      summary:
        "진행 중 결재선 변경 (현재 처리자·결재 관리자, 처리 전 이후 단계만, 사유 필수, 재인증)",
      request: {
        params: idParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                reason: z.string().trim().min(1).max(500),
                edits: z
                  .array(
                    z.discriminatedUnion("kind", [
                      z.object({
                        kind: z.literal("add"),
                        item: LineItem,
                      }),
                      z.object({ kind: z.literal("remove"), stepId: z.uuid() }),
                    ]),
                  )
                  .min(1)
                  .max(20),
              }),
            },
          },
        },
      },
      responses: {
        200: json(
          z.object({ addedStepIds: z.array(z.string()), removedStepIds: z.array(z.string()) }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      await requireReauth(tenant.accountId, session);
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { actor, membershipId } = await loadActor(tx, tenant, session.userId);
        const [doc] = await tx
          .select({ businessId: schema.document.businessId })
          .from(schema.document)
          .where(eq(schema.document.id, id));
        if (!doc) throw new ApprovalError("not_found", "문서를 찾을 수 없습니다");
        return changeLine(serviceContext(c, d, tx), {
          documentId: id,
          actor: {
            membershipId,
            isApprovalAdmin: can(actor, "approval.manage", businessTarget(doc.businessId)),
          },
          edits: body.edits,
          reason: body.reason,
        });
      });
      return c.json(result, 200);
    },
  );

  // ===== 첨부 (APV-013, FILE-002·004·005) =====
  app.openapi(
    createRoute({
      method: "post",
      path: "/approvals/{id}/attachments/upload-url",
      tags: ["approval"],
      summary: "첨부 업로드용 서명 URL (크기 고정). 업로드 후 등록 API로 검증·등록한다",
      request: {
        params: idParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                filename: z.string().min(1).max(255),
                size: z.number().int().min(1),
              }),
            },
          },
        },
      },
      responses: {
        200: json(
          z.object({ uploadUrl: z.string(), stagingKey: z.string(), contentType: z.string() }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return requestUpload(serviceContext(c, d, tx), {
          documentId: id,
          actorMembershipId: membershipId,
          ...body,
        });
      });
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/approvals/{id}/attachments",
      tags: ["approval"],
      summary: "업로드한 파일 검증·등록 (크기·실제 형식·SHA-256 확인 후 최종 경로로 복사)",
      request: {
        params: idParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                stagingKey: z.string().min(1).max(300),
                filename: z.string().min(1).max(255),
                size: z.number().int().min(1),
              }),
            },
          },
        },
      },
      responses: {
        201: json(
          z.object({
            id: z.string(),
            filename: z.string(),
            size: z.number(),
            mime: z.string(),
            sha256: z.string(),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return registerAttachment(serviceContext(c, d, tx), {
          documentId: id,
          actorMembershipId: membershipId,
          stagingKey: body.stagingKey,
          filename: body.filename,
          declaredSize: body.size,
        });
      });
      return c.json(result, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/approvals/{id}/attachments",
      tags: ["approval"],
      summary: "첨부 목록 (기안자·결재선 참여자)",
      request: { params: idParam },
      responses: {
        200: json(
          z.array(
            z.object({
              id: z.string(),
              filename: z.string(),
              size: z.number(),
              mime: z.string(),
              sha256: z.string(),
            }),
          ),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");
      const rows = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        const ctx = serviceContext(c, d, tx);
        if (!(await isParticipant(ctx, id, membershipId))) {
          throw new ApprovalError("not_found", "문서를 찾을 수 없습니다");
        }
        return listAttachments(ctx, id);
      });
      return c.json(rows, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/approvals/{id}/attachments/{attachmentId}",
      tags: ["approval"],
      summary: "첨부 삭제 (초안에서 기안자만)",
      request: { params: z.object({ id: z.uuid(), attachmentId: z.uuid() }) },
      responses: { 200: json(OkSchema), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id, attachmentId } = c.req.valid("param");
      await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        await removeAttachment(serviceContext(c, d, tx), {
          documentId: id,
          attachmentId,
          actorMembershipId: membershipId,
        });
      });
      return c.json({ ok: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/approvals/{id}/attachments/{attachmentId}/url",
      tags: ["approval"],
      summary: "첨부 다운로드·미리보기 서명 URL (권한 확인 후 5분 수명, 이미지·PDF만 미리보기)",
      request: {
        params: z.object({ id: z.uuid(), attachmentId: z.uuid() }),
        query: z.object({ preview: z.enum(["true", "false"]).optional() }),
      },
      responses: {
        200: json(z.object({ url: z.string(), filename: z.string(), mime: z.string() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const { id, attachmentId } = c.req.valid("param");
      const { preview } = c.req.valid("query");
      const result = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return attachmentUrl(serviceContext(c, d, tx), {
          documentId: id,
          attachmentId,
          membershipId,
          preview: preview === "true",
        });
      });
      return c.json(result, 200);
    },
  );

  // ===== 받은함 (결재 대기·기안함, APV-080 일부) =====
  app.openapi(
    createRoute({
      method: "get",
      path: "/inbox/pending",
      tags: ["approval"],
      summary: "결재 대기: 지금 내가 처리할 차례인 문서",
      responses: { 200: json(z.array(z.record(z.string(), z.unknown()))), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const rows = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return listPending(serviceContext(c, d, tx), membershipId);
      });
      return c.json(
        rows.map((r) => ({ ...r, submittedAt: r.submittedAt?.toISOString() ?? null })),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/inbox/mine",
      tags: ["approval"],
      summary: "기안함: 내가 기안한 문서 (임시저장·진행·회수·반려·완료)",
      responses: { 200: json(z.array(z.record(z.string(), z.unknown()))), ...errorResponses },
    }),
    async (c) => {
      const d = deps();
      const tenant = c.get("tenant");
      const rows = await withTenant(d.appDb, tenant.accountId, async (tx) => {
        const { membershipId } = await loadActor(tx, tenant, c.get("session").userId);
        return listMyDocuments(serviceContext(c, d, tx), membershipId);
      });
      return c.json(
        rows.map((r) => ({
          ...r,
          submittedAt: r.submittedAt?.toISOString() ?? null,
          updatedAt: r.updatedAt.toISOString(),
        })),
        200,
      );
    },
  );
}

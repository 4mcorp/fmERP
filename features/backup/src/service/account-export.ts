// 계정 전체 내보내기 요청·이력·다운로드 (PRD BAK-007·009, M7 plan 3·4절). ZIP은 worker가 만든다.
import { recordAudit } from "@fmerp/audit";
import { schema, type Tx, withTenant } from "@fmerp/db";
import { requireStrictReauth } from "@fmerp/shared/authz/reauth";
import type { SessionInfo } from "@fmerp/shared/contracts/system-guards";
import type { ServerDeps } from "@fmerp/shared/server/deps";
import { ApiError } from "@fmerp/shared/server/http";
import { and, desc, eq, inArray } from "drizzle-orm";

type RequestCtx = { ip?: string | null; userAgent?: string | null; requestId?: string | null };
type Tenant = { accountId: string; role: "owner" | "admin" | "member" };

const HISTORY_LIMIT = 30;
/** 내보내기 파일의 다운로드 서명 URL 유효 시간. 보관은 7일이지만 링크는 받을 때마다 짧게 발급한다 (M7 Q6) */
const DOWNLOAD_URL_SECONDS = 600;

/**
 * 내보내기는 소유자가 하고, 계정 관리자는 소유자가 허용했을 때만 한다 (PRD 3.3 각주 2).
 * 내보내기 ZIP에는 모든 완료 문서 본문이 들어 있어 문서를 볼 수 없는 관리자에게는 기본으로 막는다.
 */
async function authorizeExport(tx: Tx, tenant: Tenant): Promise<void> {
  if (tenant.role === "owner") return;
  if (tenant.role === "admin") {
    const [a] = await tx.select({ policy: schema.account.securityPolicy }).from(schema.account);
    if (a?.policy.allowAdminExport === true) return;
  }
  throw new ApiError(403, "forbidden", "계정 내보내기 권한이 없습니다");
}

/** 권한부터 확인한다. 권한이 없는 사람에게 PIN부터 요구하지 않는다 */
async function assertExportAllowed(d: ServerDeps, tenant: Tenant): Promise<void> {
  await withTenant(d.appDb, tenant.accountId, (tx) => authorizeExport(tx, tenant));
}

interface ExportItem {
  id: string;
  status: string;
  requestedByName: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  size: number | null;
  sha256: string | null;
  expiresAt: string | null;
  error: string | null;
  downloads: { at: string; userName: string | null }[];
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** 내보내기 이력(최근 순). 권한이 있는 사람만 본다 */
export async function listExports(d: ServerDeps, tenant: Tenant) {
  return withTenant(d.appDb, tenant.accountId, async (tx) => {
    await authorizeExport(tx, tenant);
    const J = schema.backupJob;
    const rows = await tx.select().from(J).orderBy(desc(J.createdAt)).limit(HISTORY_LIMIT);
    const names = new Map<string, string>();
    if (rows.length > 0) {
      const users = await tx
        .select({ id: schema.membership.id, name: schema.user.name })
        .from(schema.membership)
        .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId))
        .where(
          inArray(
            schema.membership.id,
            rows.map((r) => r.requestedByMembershipId),
          ),
        );
      for (const u of users) names.set(u.id, u.name);
    }
    const downloads = new Map<string, { at: string; userName: string | null }[]>();
    if (rows.length > 0) {
      const A = schema.auditLog;
      const logs = await tx
        .select({ targetId: A.targetId, at: A.occurredAt, userName: schema.user.name })
        .from(A)
        .leftJoin(schema.user, eq(schema.user.id, A.actorUserId))
        .where(
          and(
            eq(A.action, "account.export_download"),
            inArray(
              A.targetId,
              rows.map((r) => r.id),
            ),
          ),
        )
        .orderBy(desc(A.occurredAt));
      for (const l of logs) {
        if (!l.targetId) continue;
        const list = downloads.get(l.targetId) ?? [];
        list.push({ at: l.at.toISOString(), userName: l.userName });
        downloads.set(l.targetId, list);
      }
    }
    const [account] = await tx
      .select({ policy: schema.account.securityPolicy })
      .from(schema.account);
    const items: ExportItem[] = rows.map((r) => ({
      id: r.id,
      status: r.status,
      requestedByName: names.get(r.requestedByMembershipId) ?? null,
      createdAt: r.createdAt.toISOString(),
      startedAt: iso(r.startedAt),
      finishedAt: iso(r.finishedAt),
      size: r.size,
      sha256: r.sha256,
      expiresAt: iso(r.expiresAt),
      error: r.error,
      downloads: downloads.get(r.id) ?? [],
    }));
    return { allowAdminExport: account?.policy.allowAdminExport === true, items };
  });
}

/** 내보내기를 요청한다. 실제 ZIP 생성은 worker가 요청 행(QUEUED)을 집어 한다. 계정당 동시에 하나만 */
export async function requestExport(
  d: ServerDeps,
  tenant: Tenant,
  session: SessionInfo,
  request: RequestCtx,
) {
  await assertExportAllowed(d, tenant);
  await requireStrictReauth(d, session);
  try {
    return await withTenant(d.appDb, tenant.accountId, async (tx) => {
      await authorizeExport(tx, tenant);
      const [me] = await tx
        .select({ id: schema.membership.id })
        .from(schema.membership)
        .where(eq(schema.membership.userId, session.userId));
      if (!me) throw new ApiError(403, "forbidden", "권한이 없습니다");
      const [row] = await tx
        .insert(schema.backupJob)
        .values({
          accountId: tenant.accountId,
          type: "account_export",
          status: "QUEUED",
          requestedByMembershipId: me.id,
        })
        .returning({ id: schema.backupJob.id });
      if (!row) throw new Error("내보내기 요청 저장 실패");
      await recordAudit(tx, {
        accountId: tenant.accountId,
        actorUserId: session.userId,
        action: "account.export_request",
        target: { type: "backup_job", id: row.id },
        result: "success",
        request,
      });
      return { id: row.id };
    });
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") {
      throw new ApiError(409, "export_active", "이미 만들고 있거나 대기 중인 내보내기가 있습니다");
    }
    throw error;
  }
}

/** 완성된 ZIP의 내려받기 URL. 재인증·권한을 확인하고 발급을 감사 로그에 남긴다 */
export async function exportDownloadUrl(
  d: ServerDeps,
  tenant: Tenant,
  session: SessionInfo,
  id: string,
  request: RequestCtx,
) {
  await assertExportAllowed(d, tenant);
  await requireStrictReauth(d, session);
  return withTenant(d.appDb, tenant.accountId, async (tx) => {
    await authorizeExport(tx, tenant);
    const [job] = await tx.select().from(schema.backupJob).where(eq(schema.backupJob.id, id));
    if (!job) throw new ApiError(404, "not_found", "내보내기를 찾을 수 없습니다");
    if (
      job.status === "EXPIRED" ||
      (job.expiresAt && job.expiresAt.getTime() < d.now().getTime())
    ) {
      throw new ApiError(
        409,
        "export_expired",
        "보관 기간(7일)이 지난 내보내기입니다. 다시 요청하세요",
      );
    }
    if (job.status !== "READY" || !job.storageKey) {
      throw new ApiError(409, "export_not_ready", "아직 완성되지 않은 내보내기입니다");
    }
    // 저장소 키는 worker만 채운다(앱 역할은 못 넣는다). 그래도 이 계정의 내보내기 경로가 아니면 URL을 만들지 않는다 (다층 방어)
    if (!job.storageKey.startsWith(`exports/${tenant.accountId}/`)) {
      throw new ApiError(409, "export_invalid", "내려받을 수 없는 내보내기입니다");
    }
    const day = d.now().toISOString().slice(0, 10).replaceAll("-", "");
    const filename = `fmerp-export-${day}-${job.id.slice(-8)}.zip`;
    const url = await d.storage.presignGet(job.storageKey, DOWNLOAD_URL_SECONDS, {
      downloadName: filename,
      contentType: "application/zip",
    });
    await recordAudit(tx, {
      accountId: tenant.accountId,
      actorUserId: session.userId,
      action: "account.export_download",
      target: { type: "backup_job", id: job.id },
      result: "success",
      request,
    });
    return { url, filename, expiresInSeconds: DOWNLOAD_URL_SECONDS };
  });
}

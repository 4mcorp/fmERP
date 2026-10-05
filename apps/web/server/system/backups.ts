// 시스템 덤프 관리 (PRD BAK-005~007, M7 plan 1·2·4절). DB 덤프는 모든 계정의 데이터를 담으므로
// 환경 변수로 지정한 시스템 관리자만 다룬다. 계정(테넌트) 컨텍스트와 무관하다.
import { recordAudit } from "@fmerp/audit";
import { type ActiveSession, hasApprovalPin } from "@fmerp/auth";
import { backupHealth, isPinReauthFresh, isSystemAdmin } from "@fmerp/core";
import { schema } from "@fmerp/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { ServerDeps } from "../deps";
import { getEnv } from "../env";
import { ApiError } from "../http";

type RequestCtx = { ip?: string | null; userAgent?: string | null; requestId?: string | null };

/** 시스템 관리자인지. 기능이 꺼져 있거나 대상이 아니면 존재를 알리지 않는다 (404) */
export async function isSystemAdminUser(d: ServerDeps, userId: string): Promise<boolean> {
  const allow = getEnv().SYSTEM_ADMIN_EMAILS;
  if (!allow) return false;
  const [u] = await d.authDb
    .select({ email: schema.user.email, verified: schema.user.emailVerified })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return !!u && isSystemAdmin(u.email, u.verified, allow);
}

export async function requireSystemAdmin(d: ServerDeps, session: ActiveSession): Promise<void> {
  if (!(await isSystemAdminUser(d, session.userId))) {
    throw new ApiError(404, "not_found", "찾을 수 없습니다");
  }
}

/** 덤프는 항상 PIN 재인증을 요구한다 (계정 정책으로 면제할 수 없다) */
export async function requireStrictReauth(d: ServerDeps, session: ActiveSession): Promise<void> {
  if (!(await hasApprovalPin(d.authDb, session.userId))) {
    throw new ApiError(428, "pin_not_set", "결재 PIN을 먼저 설정하세요");
  }
  if (!isPinReauthFresh(session.pinVerifiedAt, d.now())) {
    throw new ApiError(428, "reauth_required", "결재 PIN을 입력하세요");
  }
}

const HISTORY_LIMIT = 50;
/** 덤프 파일의 다운로드 서명 URL 유효 시간 (M7 Q6와 같은 원칙: 짧게) */
const DOWNLOAD_URL_SECONDS = 600;

export interface DownloadEntry {
  at: string;
  userName: string | null;
}

export interface BackupItem {
  id: string;
  kind: string;
  status: string;
  note: string | null;
  requestedByName: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  size: number | null;
  sha256: string | null;
  pgDumpVersion: string | null;
  error: string | null;
  deleteRequestedAt: string | null;
  downloads: DownloadEntry[];
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** 덤프 이력(최근 순)과 백업 상태 */
export async function listBackups(d: ServerDeps) {
  const S = schema.systemBackup;
  const rows = await d.appDb.select().from(S).orderBy(desc(S.requestedAt)).limit(HISTORY_LIMIT);

  const userIds = [
    ...new Set(rows.map((r) => r.requestedByUserId).filter((x): x is string => !!x)),
  ];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const users = await d.authDb
      .select({ id: schema.user.id, name: schema.user.name })
      .from(schema.user)
      .where(inArray(schema.user.id, userIds));
    for (const u of users) names.set(u.id, u.name);
  }

  // 다운로드 이력은 감사 로그에 있다. 계정 없는 시스템 행위라 RLS를 우회하는 인증 DB 연결로 읽는다
  const A = schema.auditLog;
  const downloads = new Map<string, DownloadEntry[]>();
  if (rows.length > 0) {
    const logs = await d.authDb
      .select({ targetId: A.targetId, at: A.occurredAt, userName: schema.user.name })
      .from(A)
      .leftJoin(schema.user, eq(schema.user.id, A.actorUserId))
      .where(
        and(
          eq(A.action, "backup.download"),
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

  const health = backupHealth(
    d.now(),
    rows.map((r) => ({ status: r.status, kind: r.kind, finishedAt: r.finishedAt })),
  );
  const items: BackupItem[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    note: r.note,
    requestedByName: r.requestedByUserId ? (names.get(r.requestedByUserId) ?? null) : null,
    requestedAt: r.requestedAt.toISOString(),
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
    size: r.size,
    sha256: r.sha256,
    pgDumpVersion: r.pgDumpVersion,
    error: r.error,
    deleteRequestedAt: iso(r.deleteRequestedAt),
    downloads: downloads.get(r.id) ?? [],
  }));
  return {
    health: {
      state: health.state,
      lastSuccessAt: iso(health.lastSuccessAt),
      expectedBy: health.expectedBy.toISOString(),
    },
    items,
  };
}

/** 수동 덤프를 요청한다. 실제 실행은 worker가 요청 행(QUEUED)을 집어 한다 */
export async function requestManualDump(
  d: ServerDeps,
  session: ActiveSession,
  note: string | undefined,
  request: RequestCtx,
) {
  try {
    const [row] = await d.appDb
      .insert(schema.systemBackup)
      .values({
        kind: "manual",
        status: "QUEUED",
        requestedByUserId: session.userId,
        note: note?.trim() || null,
      })
      .returning({ id: schema.systemBackup.id });
    if (!row) throw new Error("덤프 요청 저장 실패");
    await recordAudit(d.authDb, {
      accountId: null,
      actorUserId: session.userId,
      action: "backup.dump_request",
      target: { type: "system_backup", id: row.id },
      result: "success",
      request,
    });
    return { id: row.id };
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") {
      throw new ApiError(409, "dump_active", "이미 실행 중이거나 대기 중인 덤프가 있습니다");
    }
    throw error;
  }
}

async function loadBackup(d: ServerDeps, id: string) {
  const [row] = await d.appDb
    .select()
    .from(schema.systemBackup)
    .where(eq(schema.systemBackup.id, id));
  if (!row) throw new ApiError(404, "not_found", "덤프를 찾을 수 없습니다");
  return row;
}

/** 암호화된 덤프 파일의 내려받기 URL. 삭제 요청된 덤프는 받을 수 없고, 발급은 감사 로그에 남긴다 */
export async function backupDownloadUrl(
  d: ServerDeps,
  session: ActiveSession,
  id: string,
  request: RequestCtx,
) {
  const row = await loadBackup(d, id);
  if (row.status !== "SUCCEEDED" || !row.storageKey || row.deleteRequestedAt) {
    throw new ApiError(409, "not_downloadable", "내려받을 수 없는 덤프입니다");
  }
  const filename = `fmerp-db-${row.id.slice(-8)}.dump.age`;
  const url = await d.storage.presignGet(row.storageKey, DOWNLOAD_URL_SECONDS, {
    downloadName: filename,
    contentType: "application/octet-stream",
  });
  await recordAudit(d.authDb, {
    accountId: null,
    actorUserId: session.userId,
    action: "backup.download",
    target: { type: "system_backup", id: row.id, label: row.kind },
    result: "success",
    request,
  });
  return { url, filename, expiresInSeconds: DOWNLOAD_URL_SECONDS };
}

/**
 * 수동 덤프 삭제 요청. 앱 키에는 삭제 권한이 없으므로(BAK-004) 객체에 `expire=1` 태그를 붙이고 이력에 표시한다.
 * 실제 삭제는 버킷 수명 주기 규칙이 한다(배포 단계에서 적용). 그 전에는 내려받을 수 없다.
 */
export async function requestBackupDeletion(
  d: ServerDeps,
  session: ActiveSession,
  id: string,
  request: RequestCtx,
) {
  const row = await loadBackup(d, id);
  if (row.kind !== "manual") {
    throw new ApiError(409, "not_deletable", "자동 덤프는 보관 규칙에 따라 자동으로 정리됩니다");
  }
  if (row.status !== "SUCCEEDED" || !row.storageKey) {
    throw new ApiError(409, "not_deletable", "완료된 수동 덤프만 삭제할 수 있습니다");
  }
  if (row.deleteRequestedAt) return { ok: true as const };
  await d.storage.setTags(row.storageKey, { expire: "1" });
  await d.appDb
    .update(schema.systemBackup)
    .set({ deleteRequestedAt: d.now() })
    .where(and(eq(schema.systemBackup.id, id), isNull(schema.systemBackup.deleteRequestedAt)));
  await recordAudit(d.authDb, {
    accountId: null,
    actorUserId: session.userId,
    action: "backup.delete_request",
    target: { type: "system_backup", id, label: row.kind },
    result: "success",
    request,
  });
  return { ok: true as const };
}

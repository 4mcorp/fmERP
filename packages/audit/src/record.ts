import { type Executor, schema } from "@fmerp/db";
import type { DiffEntry } from "./diff";

/** 요청 출처 정보 (접속지 등, PRD AUD-021) */
export interface AuditRequestContext {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * 감사 로그 한 건. 법정 필수 항목(행위자, 일시, 접속지, 처리 대상, 수행 업무, 결과)을 타입으로 강제한다 (PRD AUD-021).
 * 일시는 DB가 기록한다.
 */
export interface AuditEntry {
  /** 테넌트. 로그인처럼 계정 밖에서 일어난 행위는 null */
  accountId: string | null;
  /** 행위자. 시스템 작업이면 null */
  actorUserId: string | null;
  onBehalfOfUserId?: string | null;
  /** 수행 업무 (예: auth.login, member.deactivate) */
  action: string;
  target?: { type: string; id: string; label?: string };
  /** 처리한 정보주체 (개인정보 조회·수정 대상) */
  subjectUserId?: string | null;
  diff?: DiffEntry[];
  result: "success" | "failure";
  reason?: string;
  request: AuditRequestContext;
}

/** 감사 로그는 추가만 한다. 수정·삭제 경로를 만들지 않는다 (PRD AUD-022). */
export async function recordAudit(db: Executor, entry: AuditEntry): Promise<void> {
  await db.insert(schema.auditLog).values({
    accountId: entry.accountId,
    actorUserId: entry.actorUserId,
    onBehalfOfUserId: entry.onBehalfOfUserId ?? null,
    action: entry.action,
    targetType: entry.target?.type,
    targetId: entry.target?.id,
    targetLabel: entry.target?.label,
    subjectUserId: entry.subjectUserId ?? null,
    diff: entry.diff && entry.diff.length > 0 ? entry.diff : null,
    ip: entry.request.ip ?? null,
    userAgent: entry.request.userAgent ?? null,
    requestId: entry.request.requestId ?? null,
    result: entry.result,
    reason: entry.reason,
  });
}

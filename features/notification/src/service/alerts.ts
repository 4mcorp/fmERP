// 운영 알림 (M8 plan 6단계): 월간 접속 기록 점검 누락(AUD-026), 덤프 실패·누락(BAK-005).
// 결재 이벤트와 달리 사건이 DB 상태로 정해지므로 주기적으로 판정하고, 같은 사건은 dedupe_key로 한 번만 알린다.
import { type Actor, can, type Grant, type GrantRole } from "@fmerp/core";
import { type Db, schema, withTenant } from "@fmerp/db";
import type { OpsAlertRules } from "@fmerp/shared/contracts/ops-alerts";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { CreatedNotification } from "./consume";

const ACCOUNT_TARGET = { type: "account" } as const;

export interface AlertDeps {
  appDb: Db;
  authDb: Db;
  now: Date;
  /** 감사·백업 기능의 판정 규칙. 합성 루트가 주입한다 */
  rules: OpsAlertRules;
  /** 봇 토큰이 없으면 false: 텔레그램 발송 대상으로 표시하지 않는다 */
  telegram: boolean;
}

/**
 * 지난달 접속 기록 점검이 아직 없는 회사마다, 계정 범위 `audit.read` 보유자에게 한 번 알린다.
 * 점검 대상 달이 바뀌면(매월 1일) 새 알림이 생긴다. 점검을 마치면 더 알리지 않는다.
 */
export async function createAuditReviewAlerts(deps: AlertDeps): Promise<CreatedNotification[]> {
  const { appDb, authDb, now, rules } = deps;
  const accounts = await authDb.select({ id: schema.account.id }).from(schema.account);
  const created: CreatedNotification[] = [];
  for (const { id: accountId } of accounts) {
    const members = await authDb
      .select({ id: schema.membership.id, role: schema.membership.role })
      .from(schema.membership)
      .where(
        and(eq(schema.membership.accountId, accountId), eq(schema.membership.status, "active")),
      );
    if (members.length === 0) continue;
    const rows = await withTenant(appDb, accountId, async (tx) => {
      const reviews = await tx
        .select({
          period: schema.auditReview.period,
          reviewedAt: schema.auditReview.reviewedAt,
          abnormal: schema.auditReview.abnormal,
        })
        .from(schema.auditReview);
      const status = rules.reviewStatuses(now, reviews, 1)[0];
      if (!status) return [];
      if (status.state !== "pending") return [];
      const grants = await tx
        .select({
          membershipId: schema.roleGrant.membershipId,
          role: schema.roleGrant.role,
          scopeType: schema.roleGrant.scopeType,
          scopeId: schema.roleGrant.scopeId,
        })
        .from(schema.roleGrant);
      const recipients = members.filter((m) => {
        const actor: Actor = {
          role: m.role as Actor["role"],
          grants: grants
            .filter((g) => g.membershipId === m.id)
            .map(
              (g): Grant => ({
                role: g.role as GrantRole,
                scopeType: g.scopeType,
                scopeId: g.scopeId,
              }),
            ),
        };
        return can(actor, "audit.read", ACCOUNT_TARGET);
      });
      if (recipients.length === 0) return [];
      return tx
        .insert(schema.notification)
        .values(
          recipients.map((m) => ({
            accountId,
            recipientMembershipId: m.id,
            kind: "audit_review_due" as const,
            title: `월간 접속 기록 점검이 필요합니다 (${status.period})`,
            body: "지난달 감사 로그를 확인하고 점검 완료를 남겨 주세요",
            externalText: "월간 접속 기록 점검이 필요합니다",
            dedupeKey: `audit-review:${status.period}`,
            telegramStatus: deps.telegram ? ("PENDING" as const) : ("NONE" as const),
          })),
        )
        .onConflictDoNothing()
        .returning({ id: schema.notification.id, accountId: schema.notification.accountId });
    });
    created.push(...rows);
  }
  return deps.telegram ? created : [];
}

const DAY_MS = 24 * 3_600_000;

/**
 * 시스템 관리자에게 덤프 문제를 알린다: ① 최근 24시간 안에 실패한 덤프 ② 기한(03:30)까지 성공이 없는 누락.
 * 받는 사람은 회사 소속이 아니라 사용자 단위이므로, 그 사용자의 재직 중인 모든 회사에 인앱 알림을 만들고
 * 텔레그램은 사용자당 한 건만 보낸다(첫 회사의 알림).
 */
export async function createBackupAlerts(
  deps: AlertDeps,
  allowList: string | undefined,
): Promise<CreatedNotification[]> {
  const { appDb, authDb, now, rules } = deps;
  if (!allowList) return [];
  const users = await authDb
    .select({
      id: schema.user.id,
      email: schema.user.email,
      verified: schema.user.emailVerified,
    })
    .from(schema.user);
  const adminIds = users
    .filter((u) => rules.isSystemAdmin(u.email, u.verified, allowList))
    .map((u) => u.id);
  if (adminIds.length === 0) return [];

  const S = schema.systemBackup;
  const records = await appDb
    .select({ id: S.id, status: S.status, kind: S.kind, finishedAt: S.finishedAt })
    .from(S)
    .orderBy(desc(S.requestedAt))
    .limit(50);
  const health = rules.backupHealth(now, records);

  const problems: { key: string; title: string; body: string }[] = [];
  if (health.state === "overdue") {
    problems.push({
      key: `backup-overdue:${health.expectedBy.toISOString().slice(0, 10)}`,
      title: "자동 DB 덤프가 기한 안에 성공하지 못했습니다",
      body: `마지막 성공: ${health.lastSuccessAt ? health.lastSuccessAt.toISOString() : "없음"}`,
    });
  }
  for (const r of records) {
    if (r.status === "FAILED" && r.finishedAt && now.getTime() - r.finishedAt.getTime() < DAY_MS) {
      problems.push({
        key: `backup-failed:${r.id}`,
        title: "DB 덤프가 실패했습니다",
        body: "시스템 덤프 화면에서 오류를 확인하세요",
      });
    }
  }
  if (problems.length === 0) return [];

  const memberships = await authDb
    .select({
      id: schema.membership.id,
      accountId: schema.membership.accountId,
      userId: schema.membership.userId,
    })
    .from(schema.membership)
    .where(and(inArray(schema.membership.userId, adminIds), ne(schema.membership.status, "left")));
  const firstOfUser = new Map<string, string>();
  for (const m of [...memberships].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!firstOfUser.has(m.userId)) firstOfUser.set(m.userId, m.id);
  }

  const created: CreatedNotification[] = [];
  for (const m of memberships) {
    const sendTelegram = deps.telegram && firstOfUser.get(m.userId) === m.id;
    const rows = await withTenant(appDb, m.accountId, (tx) =>
      tx
        .insert(schema.notification)
        .values(
          problems.map((p) => ({
            accountId: m.accountId,
            recipientMembershipId: m.id,
            kind: "backup_problem" as const,
            title: p.title,
            body: p.body,
            externalText: "DB 덤프에 문제가 있습니다",
            dedupeKey: p.key,
            telegramStatus: sendTelegram ? ("PENDING" as const) : ("NONE" as const),
          })),
        )
        .onConflictDoNothing()
        .returning({ id: schema.notification.id, accountId: schema.notification.accountId }),
    );
    if (sendTelegram) created.push(...rows);
  }
  return created;
}

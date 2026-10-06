import { createHash, randomBytes, randomUUID } from "node:crypto";
import { type AuditRequestContext, recordAudit } from "@fmerp/audit";
import { type Db, schema } from "@fmerp/db";
import { AuthDomainError } from "@fmerp/shared/authz/errors";
import { requireActiveMembership } from "@fmerp/shared/authz/membership";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Auth } from "./auth";

/** 초대할 때 미리 지정하는 소속 (PRD AUTH-006). 수락 시 구성원의 주소속으로 만든다 */
export interface InvitationPreset {
  businessId: string;
  departmentId: string;
  positionId: string | null;
  dutyId: string | null;
}

export interface AuthServiceDeps {
  /** fmerp_auth 역할 연결 (RLS 우회, ADR 0005) */
  db: Db;
  auth: Auth;
}

/** 내가 속한 계정 목록 (계정 전환 메뉴용, PRD AUTH-007) */
export function listMyAccounts(db: Db, userId: string) {
  return db
    .select({
      accountId: schema.account.id,
      name: schema.account.name,
      role: schema.membership.role,
      status: schema.membership.status,
    })
    .from(schema.membership)
    .innerJoin(schema.account, eq(schema.account.id, schema.membership.accountId))
    .where(eq(schema.membership.userId, userId))
    .orderBy(schema.account.name);
}

export async function switchActiveAccount(
  db: Db,
  input: {
    sessionId: string;
    userId: string;
    accountId: string;
    request: AuditRequestContext;
  },
): Promise<void> {
  await requireActiveMembership(db, input.accountId, input.userId);
  await db
    .update(schema.session)
    .set({ activeAccountId: input.accountId })
    .where(eq(schema.session.id, input.sessionId));
  await recordAudit(db, {
    accountId: input.accountId,
    actorUserId: input.userId,
    action: "account.switch",
    target: { type: "account", id: input.accountId },
    result: "success",
    request: input.request,
  });
}

/** 새 회사(계정)를 만들고 생성자를 소유자로 등록한다 (PRD AUTH-005 ①). */
export async function createAccount(
  deps: AuthServiceDeps,
  input: { userId: string; sessionId: string; name: string; request: AuditRequestContext },
) {
  const created = await deps.auth.api.createOrganization({
    body: { name: input.name, slug: `acc-${randomUUID()}`, userId: input.userId },
  });
  if (!created) throw new Error("계정 생성 결과가 비어 있습니다");
  await recordAudit(deps.db, {
    accountId: created.id,
    actorUserId: input.userId,
    action: "account.create",
    target: { type: "account", id: created.id, label: input.name },
    result: "success",
    request: input.request,
  });
  await switchActiveAccount(deps.db, {
    sessionId: input.sessionId,
    userId: input.userId,
    accountId: created.id,
    request: input.request,
  });
  return { accountId: created.id, name: created.name };
}

/** 초대 토큰은 원문을 한 번만 보여 주고, DB에는 해시만 저장한다 (PRD AUTH-006). */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function createInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

/** 초대 링크로 들어온 사람에게 보여 줄 정보 (유효하지 않으면 null) */
export async function previewInvitation(db: Db, token: string, now: Date) {
  const [row] = await db
    .select({ accountName: schema.account.name, role: schema.invitation.role })
    .from(schema.invitation)
    .innerJoin(schema.account, eq(schema.account.id, schema.invitation.accountId))
    .where(
      and(
        eq(schema.invitation.tokenHash, hashInvitationToken(token)),
        isNull(schema.invitation.usedAt),
        isNull(schema.invitation.revokedAt),
        gt(schema.invitation.expiresAt, now),
      ),
    );
  return row ?? null;
}

/**
 * 초대를 수락한다. 링크(토큰)로 수락하므로 이메일 일치를 요구하지 않는다 (ADR 0005).
 * 동시에 두 번 수락하지 못하도록 사용 처리를 조건부 UPDATE로 먼저 선점한다.
 */
export async function acceptInvitation(
  deps: AuthServiceDeps,
  input: {
    token: string;
    userId: string;
    sessionId: string;
    now: Date;
    request: AuditRequestContext;
  },
) {
  const { db } = deps;
  const tokenHash = hashInvitationToken(input.token);
  const [target] = await db
    .select({ accountId: schema.invitation.accountId })
    .from(schema.invitation)
    .where(eq(schema.invitation.tokenHash, tokenHash));
  if (target) {
    const [existing] = await db
      .select({ id: schema.membership.id })
      .from(schema.membership)
      .where(
        and(
          eq(schema.membership.accountId, target.accountId),
          eq(schema.membership.userId, input.userId),
        ),
      );
    if (existing) throw new AuthDomainError("already_member", "이미 이 회사의 구성원입니다");
  }

  const [claimed] = await db
    .update(schema.invitation)
    .set({ usedAt: input.now, usedBy: input.userId })
    .where(
      and(
        eq(schema.invitation.tokenHash, tokenHash),
        isNull(schema.invitation.usedAt),
        isNull(schema.invitation.revokedAt),
        gt(schema.invitation.expiresAt, input.now),
      ),
    )
    .returning();
  if (!claimed) {
    throw new AuthDomainError("invitation_invalid", "만료되었거나 이미 사용된 초대입니다");
  }

  try {
    await deps.auth.api.addMember({
      body: { userId: input.userId, role: claimed.role, organizationId: claimed.accountId },
    });
  } catch (error) {
    await db
      .update(schema.invitation)
      .set({ usedAt: null, usedBy: null })
      .where(eq(schema.invitation.id, claimed.id));
    throw error;
  }

  await applyInvitationPreset(db, {
    accountId: claimed.accountId,
    userId: input.userId,
    createdBy: claimed.createdBy,
    preset: claimed.preset as Partial<InvitationPreset>,
    now: input.now,
  });

  await recordAudit(db, {
    accountId: claimed.accountId,
    actorUserId: input.userId,
    action: "invitation.accept",
    target: { type: "invitation", id: claimed.id },
    subjectUserId: input.userId,
    result: "success",
    request: input.request,
  });
  await switchActiveAccount(db, {
    sessionId: input.sessionId,
    userId: input.userId,
    accountId: claimed.accountId,
    request: input.request,
  });
  return { accountId: claimed.accountId };
}

/**
 * 초대에 지정된 사업자·부서·직위로 주소속을 만든다. 그 사이 부서나 사업자를 쓸 수 없게 되었으면
 * 소속 없이 합류시킨다(관리자가 나중에 발령한다).
 */
async function applyInvitationPreset(
  db: Db,
  input: {
    accountId: string;
    userId: string;
    createdBy: string;
    preset: Partial<InvitationPreset>;
    now: Date;
  },
) {
  const { preset } = input;
  if (!preset.businessId || !preset.departmentId) return;
  const [dept] = await db
    .select({ id: schema.department.id })
    .from(schema.department)
    .innerJoin(schema.business, eq(schema.business.id, schema.department.businessId))
    .where(
      and(
        eq(schema.department.id, preset.departmentId),
        eq(schema.department.businessId, preset.businessId),
        eq(schema.department.accountId, input.accountId),
        eq(schema.department.active, true),
        eq(schema.business.active, true),
      ),
    );
  if (!dept) return;
  const [member] = await db
    .select({ id: schema.membership.id })
    .from(schema.membership)
    .where(
      and(
        eq(schema.membership.accountId, input.accountId),
        eq(schema.membership.userId, input.userId),
      ),
    );
  if (!member) return;
  const [created] = await db
    .insert(schema.assignment)
    .values({
      accountId: input.accountId,
      membershipId: member.id,
      businessId: preset.businessId,
      departmentId: preset.departmentId,
      positionId: preset.positionId ?? null,
      dutyId: preset.dutyId ?? null,
      isPrimary: true,
      validFrom: input.now,
    })
    .returning({ id: schema.assignment.id });
  await db.insert(schema.assignmentHistory).values({
    accountId: input.accountId,
    membershipId: member.id,
    assignmentId: created?.id ?? null,
    action: "create",
    changes: { ...preset, isPrimary: true },
    effectiveDate: input.now.toISOString().slice(0, 10),
    reason: "초대 수락",
    actorUserId: input.createdBy,
  });
}

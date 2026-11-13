import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { type AuditRequestContext, recordAudit } from "@fmerp/audit";
import { type Db, schema, type Tx, withTenant } from "@fmerp/db";
import { loadActor } from "@fmerp/shared/authz/org-access";
import { type Action, type Actor, can, type Target } from "@fmerp/shared/domain/permissions";
import { ApiError } from "@fmerp/shared/server/http";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  AGENT_SCOPES,
  type AgentScope,
  type AgentTokenInput,
  type AgentTokenSummary,
  AgentTokenSummarySchema,
} from "../agent-token-schema";

const hashSecret = (secret: string) => createHash("sha256").update(secret).digest();
const invalid = () => new ApiError(401, "invalid_agent_token", "유효한 에이전트 토큰이 필요합니다");

type Owner = { accountId: string; userId: string; request: AuditRequestContext };
export interface AgentIdentity {
  tokenId: string;
  accountId: string;
  userId: string;
  membershipId: string;
  scopes: AgentScope[];
  actor: Actor;
}

export async function issueAgentToken(db: Db, owner: Owner, input: AgentTokenInput, now: Date) {
  const secret = randomBytes(32).toString("base64url");
  // SQL 오류에는 바인딩한 해시가 들어갈 수 있으므로 원본 오류를 외부 로거로 보내지 않는다.
  try {
    return await withTenant(db, owner.accountId, async (tx) => {
      const [member] = await tx
        .select()
        .from(schema.membership)
        .where(
          and(eq(schema.membership.userId, owner.userId), eq(schema.membership.status, "active")),
        );
      if (!member) throw invalid();
      const [row] = await tx
        .insert(schema.agentToken)
        .values({
          accountId: owner.accountId,
          userId: owner.userId,
          membershipId: member.id,
          name: input.name,
          scopes: input.scopes,
          secretHash: hashSecret(secret).toString("hex"),
          createdAt: now,
          expiresAt: new Date(now.getTime() + input.expiresInDays * 86_400_000),
        })
        .returning({ id: schema.agentToken.id, expiresAt: schema.agentToken.expiresAt });
      if (!row) throw new Error("agent token insert failed");
      await recordAudit(tx, {
        accountId: owner.accountId,
        actorUserId: owner.userId,
        actorKind: "human",
        agentTokenId: row.id,
        action: "agent_token.issue",
        target: { type: "agent_token", id: row.id },
        result: "success",
        request: owner.request,
      });
      return {
        id: row.id,
        token: `fmerp_agent_${row.id}.${secret}`,
        expiresAt: row.expiresAt.toISOString(),
      };
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error("에이전트 토큰 발급에 실패했습니다");
  }
}

export async function listAgentTokens(
  db: Db,
  owner: Pick<Owner, "accountId" | "userId">,
): Promise<AgentTokenSummary[]> {
  return withTenant(db, owner.accountId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.agentToken.id,
        name: schema.agentToken.name,
        scopes: schema.agentToken.scopes,
        createdAt: schema.agentToken.createdAt,
        expiresAt: schema.agentToken.expiresAt,
        revokedAt: schema.agentToken.revokedAt,
        lastUsedAt: schema.agentToken.lastUsedAt,
      })
      .from(schema.agentToken)
      .where(eq(schema.agentToken.userId, owner.userId))
      .orderBy(desc(schema.agentToken.createdAt));
    return rows.map((row) =>
      AgentTokenSummarySchema.parse({
        ...row,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        revokedAt: row.revokedAt?.toISOString() ?? null,
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      }),
    );
  });
}

export async function revokeAgentToken(db: Db, owner: Owner, id: string, now: Date) {
  return withTenant(db, owner.accountId, async (tx) => {
    const [row] = await tx
      .select({ id: schema.agentToken.id, revokedAt: schema.agentToken.revokedAt })
      .from(schema.agentToken)
      .where(and(eq(schema.agentToken.id, id), eq(schema.agentToken.userId, owner.userId)))
      .for("update");
    if (!row) throw new ApiError(404, "not_found", "토큰을 찾을 수 없습니다");
    if (row.revokedAt) return;
    await tx.update(schema.agentToken).set({ revokedAt: now }).where(eq(schema.agentToken.id, id));
    await recordAudit(tx, {
      accountId: owner.accountId,
      actorUserId: owner.userId,
      actorKind: "human",
      agentTokenId: id,
      action: "agent_token.revoke",
      target: { type: "agent_token", id },
      result: "success",
      request: owner.request,
    });
  });
}

/** B2의 쓰기는 이 콜백의 tx 안에서 권한 판정·업무 변경·감사를 완료해야 폐기와 직렬화된다. */
export async function withAgentToken<T>(
  db: Db,
  token: string,
  run: (tx: Tx, identity: AgentIdentity) => Promise<T>,
): Promise<T> {
  const parts =
    /^fmerp_agent_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/.exec(
      token,
    );
  if (!parts) throw invalid();
  const [, id, secret] = parts;
  if (!id || !secret) throw invalid();
  const lookup = await db.execute<{ account_id: string; secret_hash: string }>(
    sql`select * from public.lookup_agent_token(${id}::uuid)`,
  );
  const candidate = lookup.rows[0];
  const expected = Buffer.from(candidate?.secret_hash ?? "0".repeat(64), "hex");
  const matches = timingSafeEqual(hashSecret(secret), expected);
  if (!candidate || !matches) throw invalid();
  return withTenant(db, candidate.account_id, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.agentToken)
      .where(eq(schema.agentToken.id, id))
      .for("update");
    if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) throw invalid();
    const [member] = await tx
      .select()
      .from(schema.membership)
      .where(
        and(
          eq(schema.membership.id, row.membershipId),
          eq(schema.membership.userId, row.userId),
          eq(schema.membership.status, "active"),
        ),
      );
    if (!member || !["owner", "admin", "member"].includes(member.role)) throw invalid();
    const role = member.role === "owner" ? "owner" : member.role === "admin" ? "admin" : "member";
    const { actor } = await loadActor(tx, { accountId: row.accountId, role }, row.userId);
    const scopes = row.scopes.filter((scope): scope is AgentScope =>
      AGENT_SCOPES.some((allowed) => allowed === scope),
    );
    if (scopes.length !== row.scopes.length || scopes.length === 0) throw invalid();
    const result = await run(tx, {
      tokenId: row.id,
      accountId: row.accountId,
      userId: row.userId,
      membershipId: row.membershipId,
      scopes,
      actor,
    });
    await tx
      .update(schema.agentToken)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.agentToken.id, row.id));
    return result;
  });
}

/** 인증 결과는 요청 간 캐시하지 않는다. 업무 객체의 열람·소유권 규칙은 호출자가 별도로 검사한다. */
export function authenticateAgentToken(db: Db, token: string) {
  return withAgentToken(db, token, async (_tx, identity) => identity);
}

export function authorizeAgent(
  identity: AgentIdentity,
  scope: AgentScope,
  permission?: { action: Action; target: Target },
) {
  if (
    !identity.scopes.includes(scope) ||
    (permission && !can(identity.actor, permission.action, permission.target))
  ) {
    throw new ApiError(403, "forbidden", "권한이 없습니다");
  }
}

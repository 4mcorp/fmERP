import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createDatabase, schema, withTenant } from "@fmerp/db";
import { getTestApp, json, loginAs, type TestClient } from "@fmerp/shared/testing/test-client";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentTokenInputSchema } from "../src/agent-token-schema";
import {
  authenticateAgentToken,
  authorizeAgent,
  issueAgentToken,
  revokeAgentToken,
  withAgentToken,
} from "../src/service/agent-token";

const app = createDatabase(process.env.DATABASE_URL ?? "");
const auth = createDatabase(process.env.AUTH_DATABASE_URL ?? "");
const migrator = createDatabase(process.env.MIGRATION_DATABASE_URL ?? "");
let owner: TestClient;
let userId: string;
let accountId: string;
let membershipId: string;
let otherAccountId: string;
const input = AgentTokenInputSchema.parse({
  name: "토큰 통합 시험",
  scopes: ["org.read", "forms.write"],
  confirmed: true,
});
const ownerInfo = () => ({ accountId, userId, request: {} });
const issue = () => issueAgentToken(app.db, ownerInfo(), input, new Date());

beforeAll(async () => {
  owner = await loginAs("owner@example.com");
  const me = await json<{ id: string; activeAccountId: string }>(await owner.request("/api/me"));
  userId = me.id;
  accountId = me.activeAccountId;
  const [member] = await withTenant(app.db, accountId, (tx) =>
    tx.select().from(schema.membership).where(eq(schema.membership.userId, userId)),
  );
  if (!member) throw new Error("fixture membership missing");
  membershipId = member.id;
  const [other] = await auth.db
    .select()
    .from(schema.account)
    .where(eq(schema.account.slug, "other-company"));
  if (!other) throw new Error("fixture account missing");
  otherAccountId = other.id;
});
afterAll(async () => {
  await app.pool.end();
  await auth.pool.end();
  await migrator.pool.end();
});

async function fails(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ status: 401, code: "invalid_agent_token" });
}

describe("개인 에이전트 토큰", () => {
  it("lookup 함수 소유자·고정 search_path와 EXECUTE 권한을 검사한다", async () => {
    const result =
      await app.db.execute(sql`select pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig,
      has_function_privilege('fmerp_app', p.oid, 'EXECUTE') as app_execute,
      has_function_privilege('fmerp_auth', p.oid, 'EXECUTE') as auth_execute,
      exists(select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'lookup_agent_token'`);
    expect(result.rows).toEqual([
      {
        owner: "fmerp_migrator",
        prosecdef: true,
        proconfig: ["search_path=pg_catalog, pg_temp"],
        app_execute: true,
        auth_execute: false,
        public_execute: false,
      },
    ]);
  });
  it("해시·scope·수명 변경과 폐기 되돌리기는 DB에서 금지한다", async () => {
    const token = await issue();
    for (const patch of [
      { secretHash: "b".repeat(64) },
      { scopes: ["org.write"] },
      { expiresAt: new Date(Date.now() + 60000) },
    ]) {
      await expect(
        withTenant(app.db, accountId, (tx) =>
          tx.update(schema.agentToken).set(patch).where(eq(schema.agentToken.id, token.id)),
        ),
      ).rejects.toThrow();
      await expect(
        migrator.db.update(schema.agentToken).set(patch).where(eq(schema.agentToken.id, token.id)),
      ).rejects.toThrow();
    }
    await revokeAgentToken(app.db, ownerInfo(), token.id, new Date());
    await expect(
      withTenant(app.db, accountId, (tx) =>
        tx
          .update(schema.agentToken)
          .set({ revokedAt: null })
          .where(eq(schema.agentToken.id, token.id)),
      ),
    ).rejects.toThrow();
  });
  it("감사 실패 시 발급·폐기와 콜백 변경이 롤백된다", async () => {
    const token = await issue();
    const ownerWithFailure = { ...ownerInfo(), request: { requestId: "agent-audit-rollback" } };
    await migrator.db.execute(
      sql`alter table ${schema.auditLog} add constraint agent_test_audit_failure check (request_id is distinct from 'agent-audit-rollback') not valid`,
    );
    try {
      const before = await withTenant(app.db, accountId, (tx) =>
        tx.select({ id: schema.agentToken.id }).from(schema.agentToken),
      );
      await expect(issueAgentToken(app.db, ownerWithFailure, input, new Date())).rejects.toThrow(
        "에이전트 토큰 발급에 실패했습니다",
      );
      expect(
        await withTenant(app.db, accountId, (tx) =>
          tx.select({ id: schema.agentToken.id }).from(schema.agentToken),
        ),
      ).toEqual(before);
      await expect(
        revokeAgentToken(app.db, ownerWithFailure, token.id, new Date()),
      ).rejects.toThrow();
      await authenticateAgentToken(app.db, token.token);
      await expect(
        withAgentToken(app.db, token.token, async (tx) => {
          await tx
            .update(schema.agentToken)
            .set({ revokedAt: new Date() })
            .where(eq(schema.agentToken.id, token.id));
          await tx.insert(schema.auditLog).values({
            accountId,
            actorUserId: userId,
            action: "agent.test",
            result: "success",
            requestId: "agent-audit-rollback",
          });
        }),
      ).rejects.toThrow();
      await authenticateAgentToken(app.db, token.token);
    } finally {
      await migrator.db.execute(
        sql`alter table ${schema.auditLog} drop constraint agent_test_audit_failure`,
      );
    }
  });
  it.each(["leave", "member"] as const)(
    "동시 %s 변경은 이미 인증한 콜백을 취소하지 않고 다음 요청에서 반영한다",
    async (change) => {
      const token = await issue();
      let enter = () => {};
      let release = () => {};
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const permission = { action: "form.manage", target: { type: "account" } } as const;
      const running = withAgentToken(app.db, token.token, async (tx, identity) => {
        authorizeAgent(identity, "forms.write", permission);
        enter();
        await wait;
        await tx.insert(schema.auditLog).values({
          accountId,
          actorUserId: userId,
          agentTokenId: token.id,
          actorKind: "agent",
          action: "agent.concurrent_test",
          result: "success",
        });
      });
      await entered;
      try {
        await auth.db
          .update(schema.membership)
          .set(change === "leave" ? { status: "leave" } : { role: "member" })
          .where(eq(schema.membership.id, membershipId));
        release();
        await running;
        if (change === "leave") await fails(authenticateAgentToken(app.db, token.token));
        if (change === "member") {
          const next = await authenticateAgentToken(app.db, token.token);
          expect(() => authorizeAgent(next, "forms.write", permission)).toThrow("권한이 없습니다");
        }
      } finally {
        release();
        await Promise.allSettled([running]);
        await auth.db
          .update(schema.membership)
          .set({ status: "active", role: "owner" })
          .where(eq(schema.membership.id, membershipId));
      }
    },
  );
  it("무토큰·잘못된 비밀·미존재 id는 같은 인증 오류", async () => {
    expect((await getTestApp().request("/api/me/agent-tokens")).status).toBe(401);
    const token = await issue();
    await fails(authenticateAgentToken(app.db, ""));
    await fails(authenticateAgentToken(app.db, `${token.token.slice(0, -43)}${"a".repeat(43)}`));
    await fails(
      authenticateAgentToken(
        app.db,
        `fmerp_agent_${randomUUID()}.${randomBytes(32).toString("base64url")}`,
      ),
    );
  });
  it("검증은 현재 사용자·계정·scope만 반환하고 마지막 사용을 기록한다", async () => {
    const token = await issue();
    const identity = await authenticateAgentToken(app.db, token.token);
    expect(identity).toMatchObject({
      tokenId: token.id,
      accountId,
      userId,
      membershipId,
      scopes: input.scopes,
      actor: { role: "owner" },
    });
    expect(JSON.stringify(identity)).not.toContain("secret");
    const rows = await json<{ id: string; lastUsedAt: string | null }[]>(
      await owner.request("/api/me/agent-tokens"),
    );
    expect(rows.find((r) => r.id === token.id)?.lastUsedAt).toBeTruthy();
  });
  it("발급은 엄격한 PIN 재인증, 명시적 scope·확인이 필요하고 응답은 no-store", async () => {
    const saved = await auth.db
      .select()
      .from(schema.approvalPin)
      .where(eq(schema.approvalPin.userId, userId));
    await auth.db.delete(schema.approvalPin).where(eq(schema.approvalPin.userId, userId));
    try {
      expect(
        (await owner.request("/api/me/agent-tokens", { method: "POST", body: input })).status,
      ).toBe(428);
      expect(
        (await owner.request("/api/me/pin", { method: "PUT", body: { pin: "246810" } })).status,
      ).toBe(200);
      expect(
        (await owner.request("/api/me/agent-tokens", { method: "POST", body: input })).status,
      ).toBe(428);
      expect(
        (await owner.request("/api/me/pin/verify", { method: "POST", body: { pin: "246810" } }))
          .status,
      ).toBe(200);
      expect(
        (
          await owner.request("/api/me/agent-tokens", {
            method: "POST",
            body: { ...input, scopes: ["all"] },
          })
        ).status,
      ).toBe(400);
      const response = await owner.request("/api/me/agent-tokens", { method: "POST", body: input });
      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const created = await json<{ token: string }>(response);
      expect(created.token).toMatch(/^fmerp_agent_[0-9a-f-]+\.[A-Za-z0-9_-]{43}$/);
      await authenticateAgentToken(app.db, created.token);
    } finally {
      await auth.db.delete(schema.approvalPin).where(eq(schema.approvalPin.userId, userId));
      if (saved.length) await auth.db.insert(schema.approvalPin).values(saved);
    }
  });
  it("만료·휴직·퇴사·탈퇴는 즉시 거부된다", async () => {
    const expired = await issueAgentToken(
      app.db,
      ownerInfo(),
      input,
      new Date(Date.now() - 8 * 86_400_000),
    );
    await fails(authenticateAgentToken(app.db, expired.token));
    const token = await issue();
    try {
      for (const status of ["leave", "left"] as const) {
        await auth.db
          .update(schema.membership)
          .set({ status })
          .where(eq(schema.membership.id, membershipId));
        await fails(authenticateAgentToken(app.db, token.token));
      }
    } finally {
      await auth.db
        .update(schema.membership)
        .set({ status: "active" })
        .where(eq(schema.membership.id, membershipId));
    }
    // FK cascade로 실제 탈퇴도 토큰을 남기지 않는다. 별도 구성원을 만들어 기존 fixture는 보존한다.
    const id = randomUUID();
    await auth.db
      .insert(schema.user)
      .values({ id, name: "토큰 탈퇴 시험", email: `${id}@example.com` });
    await auth.db.insert(schema.membership).values({ accountId, userId: id, role: "member" });
    const removed = await issueAgentToken(
      app.db,
      { ...ownerInfo(), userId: id },
      input,
      new Date(),
    );
    await auth.db
      .delete(schema.membership)
      .where(and(eq(schema.membership.userId, id), eq(schema.membership.accountId, accountId)));
    await fails(authenticateAgentToken(app.db, removed.token));
    await auth.db.delete(schema.user).where(eq(schema.user.id, id));
  });
  it("역할 회수와 scope 부족은 기존 권한 교집합에서 거부된다", async () => {
    const token = await issue();
    const permission = { action: "form.manage", target: { type: "account" } } as const;
    authorizeAgent(await authenticateAgentToken(app.db, token.token), "forms.write", permission);
    try {
      await auth.db
        .update(schema.membership)
        .set({ role: "member" })
        .where(eq(schema.membership.id, membershipId));
      const identity = await authenticateAgentToken(app.db, token.token);
      expect(() => authorizeAgent(identity, "forms.write", permission)).toThrow("권한이 없습니다");
      expect(() => authorizeAgent(identity, "org.write")).toThrow("권한이 없습니다");
    } finally {
      await auth.db
        .update(schema.membership)
        .set({ role: "owner" })
        .where(eq(schema.membership.id, membershipId));
    }
  });
  it("타 계정·타인 폐기는 404, RLS 조회·쓰기와 복합 FK를 강제한다", async () => {
    const token = await issue();
    const rows = await withTenant(app.db, otherAccountId, (tx) =>
      tx.select().from(schema.agentToken).where(eq(schema.agentToken.id, token.id)),
    );
    expect(rows).toEqual([]);
    await expect(
      revokeAgentToken(app.db, { ...ownerInfo(), accountId: otherAccountId }, token.id, new Date()),
    ).rejects.toMatchObject({ status: 404 });
    const member = await loginAs("member1@example.com");
    expect(
      (await member.request(`/api/me/agent-tokens/${token.id}`, { method: "DELETE" })).status,
    ).toBe(404);
    await expect(
      withTenant(app.db, otherAccountId, (tx) =>
        tx.insert(schema.agentToken).values({
          accountId,
          membershipId,
          userId,
          name: "RLS",
          secretHash: "a".repeat(64),
          scopes: ["org.read"],
          expiresAt: new Date(Date.now() + 86400000),
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(app.db, accountId, (tx) =>
        tx.insert(schema.agentToken).values({
          accountId,
          membershipId,
          userId: randomUUID(),
          name: "FK",
          secretHash: "a".repeat(64),
          scopes: ["org.read"],
          expiresAt: new Date(Date.now() + 86400000),
        }),
      ),
    ).rejects.toThrow();
  });
  it("인증 전 전체 읽기 불가, 공개 id 단건 함수만 허용하고 authDb는 접근 불가", async () => {
    const token = await issue();
    expect(await app.db.select().from(schema.agentToken)).toEqual([]);
    const rows = await app.db.execute(
      sql`select * from public.lookup_agent_token(${token.id}::uuid)`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(Object.keys(rows.rows[0] ?? {}).sort()).toEqual(["account_id", "secret_hash"]);
    await expect(auth.db.select().from(schema.agentToken)).rejects.toThrow();
    await expect(
      auth.db.execute(sql`select * from public.lookup_agent_token(${token.id}::uuid)`),
    ).rejects.toThrow();
    await expect(
      withTenant(app.db, accountId, (tx) =>
        tx
          .update(schema.agentToken)
          .set({ scopes: ["org.write"] })
          .where(eq(schema.agentToken.id, token.id)),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(app.db, accountId, (tx) =>
        tx.delete(schema.agentToken).where(eq(schema.agentToken.id, token.id)),
      ),
    ).rejects.toThrow();
  });
  it("동시 폐기는 감사 한 건이고 재발급은 다른 키만 유효하다", async () => {
    const first = await issue();
    await Promise.all(
      Array.from({ length: 3 }, () => revokeAgentToken(app.db, ownerInfo(), first.id, new Date())),
    );
    await fails(authenticateAgentToken(app.db, first.token));
    const second = await issue();
    expect(second.token).not.toBe(first.token);
    await authenticateAgentToken(app.db, second.token);
    const audit = await withTenant(app.db, accountId, (tx) =>
      tx
        .select()
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.agentTokenId, first.id),
            eq(schema.auditLog.action, "agent_token.revoke"),
          ),
        ),
    );
    expect(audit).toHaveLength(1);
  });
  it("쓰기 트랜잭션과 폐기는 같은 토큰 잠금으로 직렬화된다", async () => {
    const token = await issue();
    let release = () => {};
    let entered = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const events: string[] = [];
    const writing = withAgentToken(app.db, token.token, async () => {
      entered();
      await gate;
      events.push("write");
    });
    await ready;
    const revoking = revokeAgentToken(app.db, ownerInfo(), token.id, new Date()).then(() => {
      events.push("revoke");
    });
    release();
    await Promise.all([writing, revoking]);
    expect(events).toEqual(["write", "revoke"]);
    await fails(authenticateAgentToken(app.db, token.token));
  });
  it("웹 세션 없는 bearer는 웹 API를 인증하지 못하고 목록·감사·로그에 비밀이 없다", async () => {
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    try {
      const token = await issue();
      const hash = createHash("sha256")
        .update(token.token.split(".")[1] ?? "")
        .digest("hex");
      expect(
        (
          await getTestApp().request("/api/me", {
            headers: { authorization: `Bearer ${token.token}` },
          })
        ).status,
      ).toBe(401);
      const list = await owner.request("/api/me/agent-tokens");
      expect(list.headers.get("cache-control")).toBe("no-store");
      const audit = await withTenant(app.db, accountId, (tx) =>
        tx.select().from(schema.auditLog).where(eq(schema.auditLog.agentTokenId, token.id)),
      );
      const output = JSON.stringify([await list.json(), audit, log.mock.calls, error.mock.calls]);
      expect(output.includes(token.token)).toBe(false);
      expect(output.includes(hash)).toBe(false);
      expect(output.includes(token.token.split(".")[1] ?? token.token)).toBe(false);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});

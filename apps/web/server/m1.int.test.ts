import { createDatabase, schema, withTenant } from "@fmerp/db";
import { json, loginAs, type TestClient } from "@fmerp/shared/testing/test-client";
import { and, desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "./app";

const env = process.env;
const appDb = createDatabase(env.DATABASE_URL ?? "");
const authDb = createDatabase(env.AUTH_DATABASE_URL ?? "");

afterAll(async () => {
  await appDb.pool.end();
  await authDb.pool.end();
});

interface Me {
  id: string;
  activeAccountId: string | null;
  accounts: { accountId: string; name: string; role: string; status: string }[];
}

/** drizzle은 PostgreSQL 오류를 cause에 감싸므로 원래 메시지로 확인한다 */
async function expectPgError(promise: Promise<unknown>, pattern: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "오류가 나야 한다").toBeInstanceOf(Error);
  const cause = (error as { cause?: { message?: string } }).cause;
  expect(cause?.message ?? (error as Error).message).toMatch(pattern);
}

async function accountIdOf(slug: string) {
  const [row] = await authDb.db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(eq(schema.account.slug, slug));
  if (!row) throw new Error(`no account ${slug}`);
  return row.id;
}

describe("접근 제어 (보안 리뷰)", () => {
  it("로그인하지 않으면 보호된 API는 모두 401", async () => {
    const paths: [string, string][] = [
      ["GET", "/api/me"],
      ["GET", "/api/me/sessions"],
      ["GET", "/api/me/login-history"],
      ["PUT", "/api/me/pin"],
      ["POST", "/api/accounts"],
      ["POST", "/api/accounts/active"],
      ["GET", "/api/account"],
      ["GET", "/api/account/members"],
      ["GET", "/api/account/invitations"],
      ["GET", "/api/invitations/aaaaaaaaaaaaaaaaaaaaaaaa"],
      ["POST", "/api/invitations/accept"],
    ];
    for (const [method, path] of paths) {
      const res = await app.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" ? undefined : "{}",
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("일반 구성원은 다른 구성원의 상태를 바꿀 수 없다", async () => {
    const member = await loginAs("member1@example.com");
    const admin = await loginAs("admin@example.com");
    const adminMe = await json<Me>(await admin.request("/api/me"));
    const res = await member.request(`/api/account/members/${adminMe.id}`, {
      method: "PATCH",
      body: { status: "left" },
    });
    expect(res.status).toBe(403);
  });

  it("다른 출처(Origin)에서 온 상태 변경 요청은 거부한다 (CSRF 이중 방어)", async () => {
    const owner = await loginAs("owner@example.com");
    const res = await app.request("/api/accounts", {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "악성회사" }),
    });
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ code: "forbidden_origin" });
  });

  it("1MB를 넘는 요청 본문은 413", async () => {
    const owner = await loginAs("owner@example.com");
    const res = await owner.request("/api/me", {
      method: "PATCH",
      body: { name: "x".repeat(1024 * 1024 + 10) },
    });
    expect(res.status).toBe(413);
  });
});

describe("개발용 테스트 로그인", () => {
  it("시드 계정으로 로그인하면 재직 중인 회사가 활성 계정이 된다", async () => {
    const owner = await loginAs("owner@example.com");
    const me = await json<Me>(await owner.request("/api/me"));
    expect(me.accounts.map((a) => a.name)).toEqual(["포엠테스트(주)"]);
    expect(me.activeAccountId).toBe(await accountIdOf("fourm-test"));
  });

  it("시드에 없는 이메일은 로그인할 수 없고, 가입 경로도 막혀 있다", async () => {
    const res = await app.request("/api/dev/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "stranger@example.com" }),
    });
    expect(res.status).toBe(400);

    const signUp = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email: "x@example.com", password: "password1234", name: "x" }),
    });
    expect(signUp.ok).toBe(false);
  });

  it("로그인 성공·실패가 감사 로그에 남는다 (AUTH-013, AUD-021)", async () => {
    const owner = await loginAs("owner@example.com");
    const history = await json<{ action: string; result: string; ip: string | null }[]>(
      await owner.request("/api/me/login-history"),
    );
    expect(history[0]).toMatchObject({ action: "auth.login", result: "success" });

    const fail = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email: "owner@example.com", password: "wrong-password" }),
    });
    expect(fail.ok).toBe(false);
    const [row] = await authDb.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, "auth.login"), eq(schema.auditLog.result, "failure")))
      .orderBy(desc(schema.auditLog.occurredAt))
      .limit(1);
    expect(row?.targetLabel).toBe("owner@example.com");
  });

  it("Better Auth의 organization·프로필 직접 변경 경로는 막혀 있다 (감사 로그 우회 방지)", async () => {
    const owner = await loginAs("owner@example.com");
    for (const path of ["/api/auth/organization/create", "/api/auth/update-user"]) {
      const res = await owner.request(path, { method: "POST", body: { name: "x" } });
      expect(res.status, path).toBe(404);
    }
  });
});

describe("테넌트 격리 (PERM-002)", () => {
  it("API: 각 회사 소유자는 자기 회사 구성원만 본다", async () => {
    const ownerA = await loginAs("owner@example.com");
    const ownerB = await loginAs("owner-b@example.com");
    const membersA = await json<{ email: string }[]>(await ownerA.request("/api/account/members"));
    const membersB = await json<{ email: string }[]>(await ownerB.request("/api/account/members"));
    expect(membersA.map((m) => m.email)).toContain("member1@example.com");
    expect(membersA.map((m) => m.email)).not.toContain("owner-b@example.com");
    expect(membersB.map((m) => m.email).sort()).toEqual([
      "multi@example.com",
      "owner-b@example.com",
    ]);
  });

  it("DB: 앱 계정은 지정한 테넌트의 행만 보고, 테넌트를 지정하지 않으면 아무것도 보지 못한다", async () => {
    const a = await accountIdOf("fourm-test");
    const inA = await withTenant(appDb.db, a, (tx) => tx.select().from(schema.membership));
    expect(inA.length).toBeGreaterThan(0);
    expect(inA.every((m) => m.accountId === a)).toBe(true);

    const noTenant = await appDb.db.select().from(schema.membership);
    expect(noTenant).toEqual([]);
  });

  it("DB: 다른 테넌트로 행을 쓰려 하면 거부된다", async () => {
    const a = await accountIdOf("fourm-test");
    const b = await accountIdOf("other-company");
    await expectPgError(
      withTenant(appDb.db, a, (tx) =>
        tx.insert(schema.auditLog).values({ accountId: b, action: "x", result: "success" }),
      ),
      /row-level security/,
    );
  });
});

describe("감사 로그 불변 (AUD-022)", () => {
  it("앱 계정은 감사 로그를 수정·삭제할 수 없다", async () => {
    const a = await accountIdOf("fourm-test");
    await expectPgError(
      withTenant(appDb.db, a, (tx) => tx.update(schema.auditLog).set({ action: "tampered" })),
      /permission denied/,
    );
    await expectPgError(
      withTenant(appDb.db, a, (tx) => tx.delete(schema.auditLog)),
      /permission denied/,
    );
  });
});

describe("초대 (AUTH-005 ②, AUTH-006)", () => {
  let admin: TestClient;
  beforeAll(async () => {
    admin = await loginAs("admin@example.com");
  });

  it("관리자가 만든 초대 링크로 소속 없는 사용자가 합류하고, 그 회사가 활성 계정이 된다", async () => {
    const created = await json<{ token: string }>(
      await admin.request("/api/account/invitations", { method: "POST", body: { role: "member" } }),
    );
    const newbie = await loginAs("newbie@example.com");
    const preview = await newbie.request(`/api/invitations/${created.token}`);
    expect(await json(preview)).toEqual({ accountName: "포엠테스트(주)", role: "member" });

    const accepted = await newbie.request("/api/invitations/accept", {
      method: "POST",
      body: { token: created.token },
    });
    expect(accepted.status).toBe(200);
    const me = await json<Me>(await newbie.request("/api/me"));
    expect(me.activeAccountId).toBe(await accountIdOf("fourm-test"));

    // 같은 초대는 다른 사람도 다시 쓸 수 없다 (1회용)
    const reuse = await (await loginAs("owner-b@example.com")).request("/api/invitations/accept", {
      method: "POST",
      body: { token: created.token },
    });
    expect(reuse.status).toBe(400);
    expect(await json(reuse)).toMatchObject({ code: "invitation_invalid" });
  });

  it("이미 구성원인 사람이 초대를 수락하면 409이고, 초대는 소모되지 않는다", async () => {
    const created = await json<{ token: string }>(
      await admin.request("/api/account/invitations", { method: "POST", body: {} }),
    );
    const member1 = await loginAs("member1@example.com");
    const res = await member1.request("/api/invitations/accept", {
      method: "POST",
      body: { token: created.token },
    });
    expect(res.status).toBe(409);
    const stillValid = await member1.request(`/api/invitations/${created.token}`);
    expect(stillValid.status).toBe(200);
  });

  it("만료된 초대는 거부된다", async () => {
    const created = await json<{ id: string; token: string }>(
      await admin.request("/api/account/invitations", { method: "POST", body: {} }),
    );
    await authDb.db
      .update(schema.invitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitation.id, created.id));
    const outsider = await loginAs("owner-b@example.com");
    const res = await outsider.request("/api/invitations/accept", {
      method: "POST",
      body: { token: created.token },
    });
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ code: "invitation_invalid" });
  });

  it("일반 구성원은 초대를 만들 수 없다", async () => {
    const member = await loginAs("member1@example.com");
    const res = await member.request("/api/account/invitations", { method: "POST", body: {} });
    expect(res.status).toBe(403);
  });
});

describe("계정 생성·전환 (AUTH-005 ①, AUTH-007)", () => {
  it("새 회사를 만들면 소유자가 되고 활성 계정이 바뀐다", async () => {
    const multi = await loginAs("multi@example.com");
    const created = await json<{ accountId: string }>(
      await multi.request("/api/accounts", { method: "POST", body: { name: "새로운회사(주)" } }),
    );
    const me = await json<Me>(await multi.request("/api/me"));
    expect(me.activeAccountId).toBe(created.accountId);
    expect(me.accounts.find((a) => a.accountId === created.accountId)?.role).toBe("owner");
  });

  it("두 회사 소속 사용자는 활성 계정을 전환할 수 있고, 소속이 아닌 회사로는 못 간다", async () => {
    const multi = await loginAs("multi@example.com");
    const other = await accountIdOf("other-company");
    const ok = await multi.request("/api/accounts/active", {
      method: "POST",
      body: { accountId: other },
    });
    expect(ok.status).toBe(200);
    const account = await json<{ name: string }>(await multi.request("/api/account"));
    expect(account.name).toBe("다른회사(주)");

    const member1 = await loginAs("member1@example.com");
    const denied = await member1.request("/api/accounts/active", {
      method: "POST",
      body: { accountId: other },
    });
    expect(denied.status).toBe(403);
  });
});

describe("구성원 비활성화 (AUTH-015)", () => {
  it("비활성 구성원은 회사 API에 들어갈 수 없다", async () => {
    const left = await loginAs("left@example.com");
    const res = await left.request("/api/account");
    expect(res.status).toBe(403);
  });

  it("관리자가 비활성화하면 그 회사 세션이 즉시 끝나고, 복귀시키면 다시 들어갈 수 있다", async () => {
    const admin = await loginAs("admin@example.com");
    const member2 = await loginAs("member2@example.com");
    const me = await json<Me>(await member2.request("/api/me"));
    expect((await member2.request("/api/account")).status).toBe(200);

    // 처리 전 결재가 남아 있으면 퇴사 처리가 거부된다(ORG-036). 다른 테스트가 남긴 진행 중 문서를 먼저 이관한다
    const accountId = await accountIdOf("fourm-test");
    await withTenant(appDb.db, accountId, async (tx) => {
      const rows = await tx
        .select({ membershipId: schema.membership.id })
        .from(schema.membership)
        .where(eq(schema.membership.userId, me.id));
      const from = rows[0]?.membershipId ?? "";
      const [heir] = await tx
        .select({ id: schema.membership.id })
        .from(schema.membership)
        .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId))
        .where(eq(schema.user.email, "bizadmin@example.com"));
      const open = await tx
        .select({ step: schema.approvalStep })
        .from(schema.approvalStep)
        .innerJoin(schema.document, eq(schema.document.id, schema.approvalStep.documentId))
        .where(sql`${schema.document.status} in ('IN_PROGRESS', 'ON_HOLD')`);
      for (const { step } of open) {
        if (!["PENDING", "ACTIVE", "HELD"].includes(step.status)) continue;
        if (!step.assigneeIds.includes(from)) continue;
        const next = [...new Set(step.assigneeIds.map((x) => (x === from ? (heir?.id ?? x) : x)))];
        await tx.execute(
          sql`select transfer_step_assignees(${step.id}::uuid, array[${sql.join(
            next.map((x) => sql`${x}::uuid`),
            sql`, `,
          )}], '[]'::jsonb)`,
        );
      }
    });

    const off = await admin.request(`/api/account/members/${me.id}`, {
      method: "PATCH",
      body: { status: "left" },
    });
    expect(off.status).toBe(200);
    expect((await member2.request("/api/account")).status).toBe(401);

    await admin.request(`/api/account/members/${me.id}`, {
      method: "PATCH",
      body: { status: "active" },
    });
    const again = await loginAs("member2@example.com");
    expect((await again.request("/api/account")).status).toBe(200);
  });
});

describe("세션 정책 (AUTH-008)", () => {
  it("2시간 이상 활동이 없으면 세션이 만료되고 지워진다", async () => {
    const member = await loginAs("member1@example.com");
    const sessions = await json<{ id: string; current: boolean }[]>(
      await member.request("/api/me/sessions"),
    );
    const current = sessions.find((s) => s.current);
    if (!current) throw new Error("현재 세션 없음");
    await authDb.db
      .update(schema.session)
      .set({ lastActiveAt: new Date(Date.now() - 3 * 3_600_000) })
      .where(eq(schema.session.id, current.id));

    const res = await member.request("/api/me");
    expect(res.status).toBe(401);
    expect(await json(res)).toMatchObject({ code: "idle_expired" });
    const [gone] = await authDb.db
      .select()
      .from(schema.session)
      .where(eq(schema.session.id, current.id));
    expect(gone).toBeUndefined();
  });
});

describe("결재 PIN (AUTH-009)", () => {
  it("형식이 틀린 PIN은 거부하고, 설정 후 확인할 수 있다", async () => {
    const owner = await loginAs("owner@example.com");
    expect(
      (await owner.request("/api/me/pin", { method: "PUT", body: { pin: "12" } })).status,
    ).toBe(400);
    expect(
      (await owner.request("/api/me/pin", { method: "PUT", body: { pin: "246810" } })).status,
    ).toBe(200);
    expect(
      (await owner.request("/api/me/pin/verify", { method: "POST", body: { pin: "246810" } }))
        .status,
    ).toBe(200);
    // 이미 PIN이 있으면 변경할 때 현재 PIN이 필요하다
    const change = await owner.request("/api/me/pin", { method: "PUT", body: { pin: "135790" } });
    expect(await json(change)).toMatchObject({ code: "pin_current_required" });
  });

  it("5회 틀리면 잠기고(423), 잠긴 동안에는 맞는 PIN도 거부된다", async () => {
    // 다른 파일(approval-m4 등)이 쓰지 않는 계정으로 시험한다: 15분 잠금과 PIN이 파일 실행 순서에 영향을 주면 안 된다
    const locked = await loginAs("auditor@example.com");
    await locked.request("/api/me/pin", { method: "PUT", body: { pin: "111111" } });
    for (let i = 0; i < 4; i++) {
      const res = await locked.request("/api/me/pin/verify", {
        method: "POST",
        body: { pin: "999999" },
      });
      expect(res.status).toBe(400);
    }
    const fifth = await locked.request("/api/me/pin/verify", {
      method: "POST",
      body: { pin: "999999" },
    });
    expect(fifth.status).toBe(423);
    const correct = await locked.request("/api/me/pin/verify", {
      method: "POST",
      body: { pin: "111111" },
    });
    expect(correct.status).toBe(423);
  });
});

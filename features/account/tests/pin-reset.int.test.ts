import { createDatabase, schema } from "@fmerp/db";
import { json, loginAs } from "@fmerp/shared/testing/test-client";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// 관리자 결재 PIN 초기화 (POST /api/account/members/{userId}/pin/reset)의 통합 시험.
// 권한(member.pin_reset: 소유자·관리자)·재인증·대상 범위·감사 기록을 본다. PIN 값은 어디에도 기록하지 않는다.

const env = process.env;
const appDb = createDatabase(env.DATABASE_URL ?? "");
const authDb = createDatabase(env.AUTH_DATABASE_URL ?? "");
const migratorDb = createDatabase(env.MIGRATION_DATABASE_URL ?? "");

const ADMIN_PIN = "246810";

afterAll(async () => {
  await appDb.pool.end();
  await authDb.pool.end();
  await migratorDb.pool.end();
});

describe("관리자 결재 PIN 초기화 (시드 회사)", () => {
  let adminId: string;
  let ownerId: string;
  let memberId: string;

  async function userIdOf(email: string): Promise<string> {
    const [row] = await authDb.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email));
    if (!row) throw new Error(`시드 사용자 없음: ${email}`);
    return row.id;
  }

  /** 대상 사용자의 결재 PIN 행을 직접 넣는다 (PIN 설정 흐름과 무관하게 초기화 효과만 본다) */
  async function insertPin(userId: string) {
    await migratorDb.pool.query(
      "insert into approval_pin (user_id, pin_hash) values ($1, $2) on conflict (user_id) do update set pin_hash = excluded.pin_hash",
      [userId, "$argon2id$v=19$m=65536,t=3,p=4$placeholder$placeholder"],
    );
  }

  async function pinCount(userId: string): Promise<number> {
    const rows = await authDb.db
      .select({ userId: schema.approvalPin.userId })
      .from(schema.approvalPin)
      .where(eq(schema.approvalPin.userId, userId));
    return rows.length;
  }

  /** 관리자 로그인 후 PIN을 확인해 세션에 재인증 시각을 남긴다 */
  async function adminWithReauth() {
    const admin = await loginAs("admin@example.com");
    const verified = await admin.request("/api/me/pin/verify", {
      method: "POST",
      body: { pin: ADMIN_PIN },
    });
    expect(verified.status).toBe(200);
    return admin;
  }

  beforeAll(async () => {
    adminId = await userIdOf("admin@example.com");
    ownerId = await userIdOf("owner@example.com");
    memberId = await userIdOf("member1@example.com");

    // 관리자 PIN을 알려진 값으로 맞춘다 (재인증 시험용)
    await migratorDb.pool.query("delete from approval_pin where user_id = $1", [adminId]);
    const admin = await loginAs("admin@example.com");
    const set = await admin.request("/api/me/pin", { method: "PUT", body: { pin: ADMIN_PIN } });
    expect(set.status).toBe(200);
  });

  afterAll(async () => {
    await migratorDb.pool.query("delete from approval_pin where user_id = $1", [adminId]);
  });

  it("재인증(PIN 확인)을 하지 않은 세션은 428로 거부하고 PIN은 지워지지 않는다", async () => {
    await insertPin(memberId);
    const admin = await loginAs("admin@example.com");
    const res = await admin.request(`/api/account/members/${memberId}/pin/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(428);
    expect(await json(res)).toMatchObject({ code: "reauth_required" });
    expect(await pinCount(memberId)).toBe(1);
  });

  it("일반 구성원은 403이고, 대상의 PIN은 지워지지 않는다", async () => {
    await insertPin(memberId);
    const member = await loginAs("member1@example.com");
    const res = await member.request(`/api/account/members/${memberId}/pin/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
    expect(await pinCount(memberId)).toBe(1);
  });

  it("관리자는 소유자의 PIN을 초기화할 수 없다 (403)", async () => {
    await insertPin(ownerId);
    const admin = await adminWithReauth();
    const res = await admin.request(`/api/account/members/${ownerId}/pin/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
    expect(await pinCount(ownerId)).toBe(1);
    await migratorDb.pool.query("delete from approval_pin where user_id = $1", [ownerId]);
  });

  it("본인의 PIN은 이 경로로 초기화할 수 없다 (400)", async () => {
    // 관리자 본인의 PIN 행은 재인증에 실제로 쓰이므로 덮어쓰지 않는다. 존재만 확인한다
    const admin = await adminWithReauth();
    const res = await admin.request(`/api/account/members/${adminId}/pin/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(400);
    expect(await pinCount(adminId)).toBe(1);
  });

  it("이 회사 구성원이 아닌 사용자는 404다 (다른 회사 사용자의 존재를 드러내지 않는다)", async () => {
    const otherId = await userIdOf("owner-b@example.com");
    const admin = await adminWithReauth();
    const res = await admin.request(`/api/account/members/${otherId}/pin/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("초기화하면 대상 PIN이 지워지고 감사 로그(pin.admin_reset)가 남으며 응답에는 개수만 있다", async () => {
    await insertPin(memberId);
    const admin = await adminWithReauth();
    const res = await admin.request(`/api/account/members/${memberId}/pin/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await json<Record<string, unknown>>(res);
    expect(body).toEqual({ removed: 1 });
    expect(await pinCount(memberId)).toBe(0);

    const [log] = await authDb.db
      .select({
        actor: schema.auditLog.actorUserId,
        result: schema.auditLog.result,
        reason: schema.auditLog.reason,
      })
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.action, "pin.admin_reset"), eq(schema.auditLog.targetId, memberId)),
      );
    expect(log?.actor).toBe(adminId);
    expect(log?.result).toBe("success");
    expect(log?.reason).toBe("PIN 1개 삭제");
  });

  it("PIN이 없는 구성원을 초기화하면 removed 0으로 성공한다", async () => {
    await migratorDb.pool.query("delete from approval_pin where user_id = $1", [memberId]);
    const admin = await adminWithReauth();
    const res = await admin.request(`/api/account/members/${memberId}/pin/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ removed: 0 });
  });

  it("소유자는 구성원의 PIN을 초기화할 수 있고, 감사 기록은 정확히 1건이며 PIN 값·해시를 담지 않는다", async () => {
    const OWNER_PIN = "135791";
    const ownerSession = await loginAs("owner@example.com");
    await migratorDb.pool.query("delete from approval_pin where user_id = $1", [ownerId]);
    const set = await ownerSession.request("/api/me/pin", {
      method: "PUT",
      body: { pin: OWNER_PIN },
    });
    expect(set.status).toBe(200);
    const verified = await ownerSession.request("/api/me/pin/verify", {
      method: "POST",
      body: { pin: OWNER_PIN },
    });
    expect(verified.status).toBe(200);

    const auditRows = async () =>
      authDb.db
        .select({ reason: schema.auditLog.reason, actor: schema.auditLog.actorUserId })
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.action, "pin.admin_reset"),
            eq(schema.auditLog.targetId, memberId),
          ),
        );
    // 같은 파일의 앞선 케이스가 남긴 감사 행을 빼고, 이번 초기화로 생긴 행만 센다
    const before = (await auditRows()).length;

    await insertPin(memberId);
    const res = await ownerSession.request(`/api/account/members/${memberId}/pin/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ removed: 1 });
    expect(await pinCount(memberId)).toBe(0);

    const logs = await auditRows();
    expect(logs.length - before).toBe(1);
    expect(logs.some((r) => r.actor === ownerId && r.reason === "PIN 1개 삭제")).toBe(true);
    for (const r of logs) {
      expect(r.reason).not.toContain(OWNER_PIN);
      expect(r.reason).not.toContain("argon2");
    }

    await migratorDb.pool.query("delete from approval_pin where user_id = $1", [ownerId]);
  });

  it("사업자 관리자는 구성원 PIN을 초기화할 수 없다 (403), 대상 PIN은 유지된다", async () => {
    await insertPin(memberId);
    const bizAdmin = await loginAs("bizadmin@example.com");
    const res = await bizAdmin.request(`/api/account/members/${memberId}/pin/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
    expect(await pinCount(memberId)).toBe(1);
    await migratorDb.pool.query("delete from approval_pin where user_id = $1", [memberId]);
  });

  it("초기화 후 대상 구성원은 자기 PIN을 다시 설정할 수 있다 (재설정 가능)", async () => {
    await migratorDb.pool.query("delete from approval_pin where user_id = $1", [memberId]);
    const member = await loginAs("member1@example.com");
    const set = await member.request("/api/me/pin", {
      method: "PUT",
      body: { pin: "112233" },
    });
    expect(set.status).toBe(200);
    expect(await pinCount(memberId)).toBe(1);
    await migratorDb.pool.query("delete from approval_pin where user_id = $1", [memberId]);
  });
});

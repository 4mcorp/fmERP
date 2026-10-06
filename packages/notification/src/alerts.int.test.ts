// M8 통합 테스트: 월간 점검 누락 알림과 덤프 문제 알림 (실제 DB)
import { createDatabase } from "@fmerp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditReviewAlerts, createBackupAlerts } from "./alerts";
import { testOpsRules } from "./test-support";

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name}이 없습니다`);
  return v;
};
const app = createDatabase(need("DATABASE_URL"));
const auth = createDatabase(need("AUTH_DATABASE_URL"));
const owner = createDatabase(need("MIGRATION_DATABASE_URL"));

const emailOf: Record<string, string> = {};
let accountId = "";
let ownerMembership = "";

async function recipientsOf(dedupeKey: string) {
  const r = await owner.pool.query<{ email: string; telegram_status: string; account_id: string }>(
    `select u.email, n.telegram_status, n.account_id from notification n
       join membership m on m.id = n.recipient_membership_id
       join "user" u on u.id = m.user_id
      where n.dedupe_key = $1 order by u.email`,
    [dedupeKey],
  );
  return r.rows;
}

beforeAll(async () => {
  const a = await owner.pool.query<{ id: string }>(
    "select id from account where slug = 'fourm-test'",
  );
  accountId = a.rows[0]?.id ?? "";
  const m = await owner.pool.query<{ id: string }>(
    `select m.id from membership m join "user" u on u.id = m.user_id
      where m.account_id = $1 and u.email = 'owner@example.com'`,
    [accountId],
  );
  ownerMembership = m.rows[0]?.id ?? "";
  emailOf.owner = "owner@example.com";
  if (!accountId || !ownerMembership) throw new Error("시드 계정이 없습니다");
});

afterAll(async () => {
  await owner.pool.query(
    "delete from notification where dedupe_key like 'audit-review:20%' or dedupe_key like 'backup-%'",
  );
  await owner.pool.query("delete from system_backup where note = 'm8-alerts-test'");
  await Promise.all([app.pool.end(), auth.pool.end(), owner.pool.end()]);
});

describe("월간 접속 기록 점검 누락 알림 (AUD-026)", () => {
  const deps = (now: Date, telegram = true) => ({
    appDb: app.db,
    authDb: auth.db,
    now,
    rules: testOpsRules,
    telegram,
  });
  // 점검 기록이 없는 먼 미래의 달을 쓴다 (점검 기록은 추가 전용이라 지울 수 없다)
  const MARCH_2030 = new Date("2030-03-05T00:00:00+09:00");

  it("점검 기록이 없으면 계정 범위 audit.read 보유자에게만 한 번 알린다", async () => {
    await owner.pool.query("delete from notification where dedupe_key = 'audit-review:2030-02'");
    // member2에게 계정 범위 감사인 역할을 임시로 준다 (시드의 감사인은 부서 범위라 대상이 아니다)
    const grant = await owner.pool.query<{ id: string }>(
      `insert into role_grant (account_id, membership_id, role, scope_type)
       select m.account_id, m.id, 'auditor', 'account' from membership m join "user" u on u.id = m.user_id
        where m.account_id = $1 and u.email = 'member2@example.com' returning id`,
      [accountId],
    );
    try {
      await runAuditCase();
    } finally {
      await owner.pool.query("delete from role_grant where id = $1", [grant.rows[0]?.id]);
    }
  });

  async function runAuditCase() {
    const created = await createAuditReviewAlerts(deps(MARCH_2030));
    expect(created.length).toBeGreaterThan(0);

    const rows = (await recipientsOf("audit-review:2030-02")).filter(
      (r) => r.account_id === accountId,
    );
    const emails = rows.map((r) => r.email);
    expect(emails).toContain("owner@example.com");
    expect(emails).toContain("admin@example.com");
    expect(emails).toContain("member2@example.com");
    // 부서 범위 감사인과 일반 구성원은 대상이 아니다
    expect(emails).not.toContain("auditor@example.com");
    expect(emails).not.toContain("member1@example.com");
    expect(rows.every((r) => r.telegram_status === "PENDING")).toBe(true);

    // 다시 판정해도 새 알림이 없다
    expect(await createAuditReviewAlerts(deps(MARCH_2030))).toEqual([]);
  }

  it("봇이 없으면 텔레그램 대상으로 표시하지 않는다", async () => {
    await owner.pool.query("delete from notification where dedupe_key = 'audit-review:2030-02'");
    expect(await createAuditReviewAlerts(deps(MARCH_2030, false))).toEqual([]);
    const rows = await recipientsOf("audit-review:2030-02");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.telegram_status === "NONE")).toBe(true);
  });

  it("그 달의 점검 기록이 있으면 알리지 않는다", async () => {
    await owner.pool.query(
      `insert into audit_review (account_id, period, reviewer_membership_id, abnormal)
       values ($1, '2031-02', $2, false)`,
      [accountId, ownerMembership],
    );
    await createAuditReviewAlerts(deps(new Date("2031-03-05T00:00:00+09:00")));
    const rows = (await recipientsOf("audit-review:2031-02")).filter(
      (r) => r.account_id === accountId,
    );
    expect(rows).toEqual([]);
  });
});

describe("덤프 문제 알림 (BAK-005)", () => {
  const deps = () => ({
    appDb: app.db,
    authDb: auth.db,
    now: new Date(),
    rules: testOpsRules,
    telegram: true,
  });

  it("실패한 덤프를 시스템 관리자에게만 한 번 알린다", async () => {
    const r = await owner.pool.query<{ id: string }>(
      `insert into system_backup (kind, status, note, finished_at, error)
       values ('manual', 'FAILED', 'm8-alerts-test', now(), 'test') returning id`,
    );
    const key = `backup-failed:${r.rows[0]?.id}`;

    const created = await createBackupAlerts(deps(), "owner@example.com");
    expect(created.length).toBeGreaterThan(0);
    const rows = await recipientsOf(key);
    expect(rows.map((x) => x.email)).toEqual(["owner@example.com"]);
    expect(rows[0]?.telegram_status).toBe("PENDING");

    // 같은 사건은 다시 만들지 않는다
    expect(await createBackupAlerts(deps(), "owner@example.com")).toEqual([]);
  });

  it("시스템 관리자 목록이 비어 있거나 인증되지 않은 사용자면 아무도 받지 않는다", async () => {
    expect(await createBackupAlerts(deps(), undefined)).toEqual([]);
    expect(await createBackupAlerts(deps(), "nobody@example.com")).toEqual([]);
  });
});

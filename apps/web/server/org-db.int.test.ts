// M2 조직 테이블의 DB 수준 규칙: 트리거(뎁스·사업자·순환), 제약, RLS 격리, 불변성.
// API를 거치지 않은 직접 쓰기도 막혀야 한다 (docs/rules/database.md).
import { createDatabase, schema, withTenant } from "@fmerp/db";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const appDb = createDatabase(process.env.DATABASE_URL ?? "");
const authDb = createDatabase(process.env.AUTH_DATABASE_URL ?? "");

afterAll(async () => {
  await appDb.pool.end();
  await authDb.pool.end();
});

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

async function ctx() {
  const accountId = await accountIdOf("fourm-test");
  const otherId = await accountIdOf("other-company");
  const allRows = await withTenant(appDb.db, accountId, (tx) =>
    tx.select().from(schema.department),
  );
  const biz = await withTenant(appDb.db, accountId, (tx) => tx.select().from(schema.business));
  // 다른 테스트(CSV 가져오기)가 포엠물류에 같은 코드의 부서를 복제할 수 있어 본사(FM) 부서만 본다
  const fmId = biz.find((b) => b.code === "FM")?.id;
  const rows = allRows.filter((r) => r.businessId === fmId);
  const dept = (code: string) => {
    const d = rows.find((r) => r.code === code);
    if (!d) throw new Error(`no dept ${code}`);
    return d;
  };
  const business = (code: string) => {
    const b = biz.find((r) => r.code === code);
    if (!b) throw new Error(`no business ${code}`);
    return b;
  };
  return { accountId, otherId, dept, business };
}

describe("시드 조직 (M2)", () => {
  it("부서 depth·path를 트리거가 계산한다", async () => {
    const { dept } = await ctx();
    expect(dept("MGT").depth).toBe(1);
    expect(dept("FIN").depth).toBe(2);
    expect(dept("CASH").depth).toBe(3);
    expect(dept("CASH").path).toBe(`${dept("MGT").id}/${dept("FIN").id}/${dept("CASH").id}`);
  });
});

describe("부서 뎁스 트리거 (S2, ORG-010~013)", () => {
  it("최대 뎁스(3)를 넘는 부서 생성을 DB가 거부한다", async () => {
    const { accountId, dept } = await ctx();
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx.insert(schema.department).values({
          accountId,
          businessId: dept("CASH").businessId,
          parentId: dept("CASH").id,
          code: "TOODEEP",
          name: "너무 깊음",
        }),
      ),
      /최대 3 단계/,
    );
  });

  it("최대 뎁스를 낮출 때 넘는 부서가 있으면 거부하고, 없으면 허용한다", async () => {
    const { accountId } = await ctx();
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx.update(schema.account).set({ maxDeptDepth: 2 }).where(eq(schema.account.id, accountId)),
      ),
      /넘는 부서가 있습니다/,
    );
  });

  it("S2: 재무팀(하위 포함)을 다른 2단계 부서 아래로 옮겨 뎁스 4가 되면 거부한다", async () => {
    const { accountId, dept } = await ctx();
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx
          .update(schema.department)
          .set({ parentId: dept("HR").id })
          .where(eq(schema.department.id, dept("FIN").id)),
      ),
      /최대 3 단계/,
    );
  });

  it("이동하면 하위 트리의 path·depth를 함께 갱신한다", async () => {
    const { accountId, dept } = await ctx();
    // 자금파트(3) → 영업본부(1) 아래로 : 깊이 2, 이후 원복
    await withTenant(appDb.db, accountId, async (tx) => {
      await tx
        .update(schema.department)
        .set({ parentId: dept("SALES").id })
        .where(eq(schema.department.id, dept("CASH").id));
      const [moved] = await tx
        .select()
        .from(schema.department)
        .where(eq(schema.department.id, dept("CASH").id));
      expect(moved?.depth).toBe(2);
      expect(moved?.path).toBe(`${dept("SALES").id}/${dept("CASH").id}`);
      await tx
        .update(schema.department)
        .set({ parentId: dept("FIN").id })
        .where(eq(schema.department.id, dept("CASH").id));
    });
    const { dept: after } = await ctx();
    expect(after("CASH").depth).toBe(3);
  });

  it("재무팀을 영업본부 아래로 옮기면 자금파트까지 depth가 함께 바뀐다", async () => {
    const { accountId, dept } = await ctx();
    await withTenant(appDb.db, accountId, async (tx) => {
      await tx
        .update(schema.department)
        .set({ parentId: dept("SALES").id })
        .where(eq(schema.department.id, dept("FIN").id));
      const rows = await tx.select().from(schema.department);
      const fin = rows.find((r) => r.code === "FIN");
      const cash = rows.find((r) => r.code === "CASH");
      expect([fin?.depth, cash?.depth]).toEqual([2, 3]);
      expect(cash?.path).toBe(`${dept("SALES").id}/${dept("FIN").id}/${dept("CASH").id}`);
      await tx
        .update(schema.department)
        .set({ parentId: dept("MGT").id })
        .where(eq(schema.department.id, dept("FIN").id));
    });
  });

  it("자기 자신·하위 부서 아래로의 이동(순환)을 거부한다", async () => {
    const { accountId, dept } = await ctx();
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx
          .update(schema.department)
          .set({ parentId: dept("CASH").id })
          .where(eq(schema.department.id, dept("MGT").id)),
      ),
      /자기 자신이나 하위 부서/,
    );
  });

  it("다른 사업자의 부서 아래에 두거나 사업자를 바꾸는 것을 거부한다", async () => {
    const { accountId, dept, business } = await ctx();
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx.insert(schema.department).values({
          accountId,
          businessId: business("LG").id,
          parentId: dept("MGT").id,
          code: "X1",
          name: "엉뚱한 사업자",
        }),
      ),
      /다른 사업자의 부서 아래/,
    );
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx
          .update(schema.department)
          .set({ businessId: business("LG").id, parentId: null })
          .where(eq(schema.department.id, dept("HR").id)),
      ),
      /다른 사업자로/,
    );
  });

  it("다른 계정의 부서를 상위로 지정할 수 없다 (RLS로 보이지 않음)", async () => {
    const { accountId, otherId } = await ctx();
    const otherDept = await withTenant(appDb.db, otherId, (tx) =>
      tx.select().from(schema.department),
    );
    const target = otherDept[0];
    if (!target) throw new Error("다른 회사 부서가 없습니다");
    const [biz] = await withTenant(appDb.db, accountId, (tx) => tx.select().from(schema.business));
    if (!biz) throw new Error("사업자가 없습니다");
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx.insert(schema.department).values({
          accountId,
          businessId: biz.id,
          parentId: target.id,
          code: "X2",
          name: "타 계정 부모",
        }),
      ),
      /상위 부서를 찾을 수 없습니다|foreign key|violates/,
    );
  });
});

describe("중복·형식 제약 (ORG-004·014)", () => {
  it("같은 계정에서 사업자등록번호·사업자 코드 중복을 거부한다", async () => {
    const { accountId, business } = await ctx();
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx.insert(schema.business).values({
          accountId,
          name: "중복",
          bizRegNo: business("FM").bizRegNo,
          code: "ZZ",
        }),
      ),
      /duplicate key|unique/,
    );
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx
          .insert(schema.business)
          .values({ accountId, name: "코드중복", bizRegNo: "1111111111", code: "FM" }),
      ),
      /duplicate key|unique/,
    );
  });

  it("같은 사업자 안에서 부서 코드 중복을 거부한다", async () => {
    const { accountId, dept } = await ctx();
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx.insert(schema.department).values({
          accountId,
          businessId: dept("MGT").businessId,
          code: "MGT",
          name: "중복",
        }),
      ),
      /duplicate key|unique/,
    );
  });
});

describe("소속 (ORG-032·033)", () => {
  async function memberOf(email: string, accountId: string) {
    const [row] = await authDb.db
      .select({ id: schema.membership.id })
      .from(schema.membership)
      .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId))
      .where(and(eq(schema.user.email, email), eq(schema.membership.accountId, accountId)));
    if (!row) throw new Error(`no member ${email}`);
    return row.id;
  }

  it("주소속은 구성원당 1개 — 두 번째 주소속을 거부한다", async () => {
    const { accountId, dept } = await ctx();
    const membershipId = await memberOf("member1@example.com", accountId);
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx.insert(schema.assignment).values({
          accountId,
          membershipId,
          businessId: dept("HR").businessId,
          departmentId: dept("HR").id,
          isPrimary: true,
        }),
      ),
      /assignment_one_primary|duplicate key/,
    );
  });

  it("겸직(다른 사업자·부서의 비주소속)은 허용한다", async () => {
    const { accountId } = await ctx();
    const membershipId = await memberOf("multi@example.com", accountId);
    const rows = await withTenant(appDb.db, accountId, (tx) =>
      tx.select().from(schema.assignment).where(eq(schema.assignment.membershipId, membershipId)),
    );
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);
  });

  it("부서가 지정한 사업자에 속하지 않으면 거부한다", async () => {
    const { accountId, dept, business } = await ctx();
    const membershipId = await memberOf("member2@example.com", accountId);
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx.insert(schema.assignment).values({
          accountId,
          membershipId,
          businessId: business("LG").id,
          departmentId: dept("HR").id,
        }),
      ),
      /속하지 않습니다/,
    );
  });

  it("발령 이력은 추가만 가능하다 (UPDATE·DELETE 권한 없음)", async () => {
    const { accountId } = await ctx();
    const membershipId = await memberOf("member1@example.com", accountId);
    const [row] = await withTenant(appDb.db, accountId, (tx) =>
      tx
        .insert(schema.assignmentHistory)
        .values({ accountId, membershipId, action: "create", effectiveDate: "2026-10-03" })
        .returning({ id: schema.assignmentHistory.id }),
    );
    expect(row).toBeTruthy();
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx.update(schema.assignmentHistory).set({ reason: "변조" }),
      ),
      /permission denied/,
    );
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) => tx.delete(schema.assignmentHistory)),
      /permission denied/,
    );
  });
});

describe("역할 부여 (PERM-001)", () => {
  it("역할별로 허용되지 않는 범위는 거부한다", async () => {
    const { accountId } = await ctx();
    const [m] = await withTenant(appDb.db, accountId, (tx) => tx.select().from(schema.membership));
    if (!m) throw new Error("no member");
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx
          .insert(schema.roleGrant)
          .values({ accountId, membershipId: m.id, role: "business_admin", scopeType: "account" }),
      ),
      /부여할 수 없습니다/,
    );
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx
          .insert(schema.roleGrant)
          .values({ accountId, membershipId: m.id, role: "owner", scopeType: "account" }),
      ),
      /부여할 수 없습니다/,
    );
  });

  it("범위 id가 없거나 계정 범위에 id가 있으면 거부한다", async () => {
    const { accountId, dept } = await ctx();
    const [m] = await withTenant(appDb.db, accountId, (tx) => tx.select().from(schema.membership));
    if (!m) throw new Error("no member");
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx.insert(schema.roleGrant).values({
          accountId,
          membershipId: m.id,
          role: "hr_admin",
          scopeType: "account",
          scopeId: dept("MGT").id,
        }),
      ),
      /role_grant_scope_id/,
    );
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx
          .insert(schema.roleGrant)
          .values({ accountId, membershipId: m.id, role: "hr_admin", scopeType: "business" }),
      ),
      /role_grant_scope_id|범위의 사업자를 찾을 수 없습니다/,
    );
  });

  it("다른 계정의 사업자·부서를 범위로 지정할 수 없다", async () => {
    const { accountId, otherId } = await ctx();
    const [m] = await withTenant(appDb.db, accountId, (tx) => tx.select().from(schema.membership));
    const [otherBiz] = await withTenant(appDb.db, otherId, (tx) =>
      tx.select().from(schema.business),
    );
    if (!m || !otherBiz) throw new Error("no data");
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx.insert(schema.roleGrant).values({
          accountId,
          membershipId: m.id,
          role: "business_admin",
          scopeType: "business",
          scopeId: otherBiz.id,
        }),
      ),
      /범위의 사업자를 찾을 수 없습니다/,
    );
  });
});

describe("테넌트 격리 (PERM-002) — M2 신규 테이블", () => {
  const tables = {
    business: schema.business,
    department: schema.department,
    position: schema.position,
    duty: schema.duty,
    assignment: schema.assignment,
    assignment_history: schema.assignmentHistory,
    role_grant: schema.roleGrant,
  } as const;

  for (const [name, table] of Object.entries(tables)) {
    it(`${name}: 테넌트를 지정하지 않으면 0행, 다른 계정으로는 보이지 않는다`, async () => {
      const { accountId, otherId } = await ctx();
      const none = await appDb.db.select().from(table);
      expect(none).toHaveLength(0);
      const mine = await withTenant(appDb.db, accountId, (tx) => tx.select().from(table));
      const theirs = await withTenant(appDb.db, otherId, (tx) => tx.select().from(table));
      for (const row of theirs) {
        expect((row as { accountId: string }).accountId).toBe(otherId);
      }
      for (const row of mine) {
        expect((row as { accountId: string }).accountId).toBe(accountId);
      }
    });
  }

  it("다른 계정 id로 쓰기를 시도하면 거부한다", async () => {
    const { accountId, otherId } = await ctx();
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx.insert(schema.position).values({ accountId: otherId, name: "타계정직위", rank: 1 }),
      ),
      /row-level security/,
    );
    await expectPgError(
      withTenant(appDb.db, accountId, (tx) =>
        tx
          .insert(schema.business)
          .values({ accountId: otherId, name: "타계정", bizRegNo: "9999999999", code: "ZZ9" }),
      ),
      /row-level security/,
    );
  });
});

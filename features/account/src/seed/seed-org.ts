import { DEFAULT_POSITIONS, makeBusinessNumber } from "@fmerp/core";
import { type Db, schema } from "@fmerp/db";
import { and, eq } from "drizzle-orm";
import { TEST_ACCOUNTS } from "../service/test-accounts";

/**
 * 개발·테스트용 조직 데이터 (M2 계획 5장). 사업자·부서·직위·소속·역할을 넣는다.
 * 소유자 권한이 필요한 DB 연결(마이그레이션 계정)로 실행하고, 여러 번 실행해도 같은 결과가 되도록(멱등) 확인한다.
 * seedTestAccounts 다음에 실행한다.
 */

interface DeptDef {
  code: string;
  name: string;
  parent?: string;
}

interface BusinessDef {
  code: string;
  name: string;
  bizRegNo: string;
  depts: DeptDef[];
}

const MAIN_BUSINESSES: BusinessDef[] = [
  {
    code: "FM",
    name: "포엠테스트 본사",
    bizRegNo: "2208162517",
    depts: [
      { code: "MGT", name: "경영지원본부" },
      { code: "FIN", name: "재무팀", parent: "MGT" },
      { code: "CASH", name: "자금파트", parent: "FIN" },
      { code: "HR", name: "인사팀", parent: "MGT" },
      { code: "SALES", name: "영업본부" },
    ],
  },
  {
    code: "LG",
    name: "포엠물류",
    bizRegNo: "1208800767",
    depts: [{ code: "LOG", name: "물류팀" }],
  },
];

const OTHER_BUSINESSES: BusinessDef[] = [
  {
    code: "OT",
    name: "다른회사 본점",
    bizRegNo: makeBusinessNumber("110111123"),
    depts: [{ code: "OPS", name: "운영팀" }],
  },
];

/** 부서 코드 → 부서장 이메일 (본사). 기본 양식의 기본 결재선(기안자의 부서장)이 해석되도록 한다 */
const DEPARTMENT_HEADS: Record<string, string> = {
  FIN: "member2@example.com",
  MGT: "bizadmin@example.com",
};

const DUTIES = ["대표이사", "본부장", "팀장", "파트장"];

interface SeedAssignment {
  business: string;
  dept: string;
  position: string;
  duty?: string;
  primary: boolean;
}

const main = (dept: string, position: string, duty?: string): SeedAssignment => ({
  business: "FM",
  dept,
  position,
  duty,
  primary: true,
});

/** 이메일 → 소속 */
const ASSIGNMENTS: Record<string, SeedAssignment[]> = {
  "owner@example.com": [main("MGT", "대표이사", "대표이사")],
  "admin@example.com": [main("HR", "부장", "팀장")],
  "member1@example.com": [main("FIN", "사원")],
  "member2@example.com": [main("FIN", "대리", "팀장")],
  "bizadmin@example.com": [main("MGT", "이사", "본부장")],
  "hr@example.com": [main("HR", "과장")],
  "auditor@example.com": [main("MGT", "차장")],
  "approver@example.com": [main("SALES", "부장", "본부장")],
  "multi@example.com": [
    main("SALES", "과장"),
    { business: "LG", dept: "LOG", position: "과장", primary: false },
  ],
  "owner-b@example.com": [
    { business: "OT", dept: "OPS", position: "대표이사", duty: "대표이사", primary: true },
  ],
};

interface SeedGrant {
  role: "business_admin" | "approval_admin" | "auditor" | "hr_admin";
  scope:
    | { type: "account" }
    | { type: "business"; code: string }
    | { type: "department"; code: string };
}

const GRANTS: Record<string, SeedGrant[]> = {
  "bizadmin@example.com": [{ role: "business_admin", scope: { type: "business", code: "FM" } }],
  "hr@example.com": [{ role: "hr_admin", scope: { type: "account" } }],
  "auditor@example.com": [{ role: "auditor", scope: { type: "department", code: "MGT" } }],
  "approver@example.com": [{ role: "approval_admin", scope: { type: "account" } }],
};

/** 새 회사에 기본 양식을 설치하는 함수. 양식은 결재 기능의 것이라 호출하는 쪽(합성 루트)이 넘긴다 */
export type InstallDefaultForms = (db: Db, accountId: string) => Promise<unknown>;

async function seedAccountOrg(
  db: Db,
  installDefaultForms: InstallDefaultForms,
  accountId: string,
  maxDeptDepth: number,
  businesses: BusinessDef[],
) {
  await db.update(schema.account).set({ maxDeptDepth }).where(eq(schema.account.id, accountId));
  await installDefaultForms(db, accountId);

  const positionIds = new Map<string, string>();
  for (const p of DEFAULT_POSITIONS) {
    const [row] = await db
      .insert(schema.position)
      .values({ accountId, name: p.name, rank: p.rank })
      .onConflictDoUpdate({
        target: [schema.position.accountId, schema.position.name],
        set: { rank: p.rank },
      })
      .returning({ id: schema.position.id });
    if (row) positionIds.set(p.name, row.id);
  }
  const dutyIds = new Map<string, string>();
  for (const name of DUTIES) {
    const [row] = await db
      .insert(schema.duty)
      .values({ accountId, name })
      .onConflictDoUpdate({ target: [schema.duty.accountId, schema.duty.name], set: { name } })
      .returning({ id: schema.duty.id });
    if (row) dutyIds.set(name, row.id);
  }

  const businessIds = new Map<string, string>();
  const departmentIds = new Map<string, string>();
  for (const b of businesses) {
    const [biz] = await db
      .insert(schema.business)
      .values({ accountId, name: b.name, bizRegNo: b.bizRegNo, code: b.code })
      .onConflictDoUpdate({
        target: [schema.business.accountId, schema.business.bizRegNo],
        set: { name: b.name, code: b.code },
      })
      .returning({ id: schema.business.id });
    if (!biz) continue;
    businessIds.set(b.code, biz.id);
    const idsInBusiness = new Map<string, string>();
    for (const [index, d] of b.depts.entries()) {
      const [dept] = await db
        .insert(schema.department)
        .values({
          accountId,
          businessId: biz.id,
          parentId: d.parent ? idsInBusiness.get(d.parent) : null,
          code: d.code,
          name: d.name,
          sort: index,
        })
        .onConflictDoUpdate({
          target: [schema.department.businessId, schema.department.code],
          set: { name: d.name, sort: index },
        })
        .returning({ id: schema.department.id });
      if (dept) {
        idsInBusiness.set(d.code, dept.id);
        departmentIds.set(d.code, dept.id);
      }
    }
  }
  return { positionIds, dutyIds, businessIds, departmentIds };
}

export async function seedTestOrganization(
  db: Db,
  installDefaultForms: InstallDefaultForms,
): Promise<void> {
  const accounts = await db
    .select({ id: schema.account.id, slug: schema.account.slug })
    .from(schema.account);
  const mainId = accounts.find((a) => a.slug === TEST_ACCOUNTS.main.slug)?.id;
  const otherId = accounts.find((a) => a.slug === TEST_ACCOUNTS.other.slug)?.id;
  if (!mainId || !otherId) {
    throw new Error("테스트 계정이 없습니다. 먼저 seedTestAccounts를 실행하세요");
  }

  const mainOrg = await seedAccountOrg(db, installDefaultForms, mainId, 3, MAIN_BUSINESSES);
  const otherOrg = await seedAccountOrg(db, installDefaultForms, otherId, 2, OTHER_BUSINESSES);

  const members = await db
    .select({
      membershipId: schema.membership.id,
      accountId: schema.membership.accountId,
      email: schema.user.email,
    })
    .from(schema.membership)
    .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId));

  for (const m of members) {
    const ctx = m.accountId === mainId ? mainOrg : m.accountId === otherId ? otherOrg : null;
    if (!ctx) continue;
    for (const a of ASSIGNMENTS[m.email] ?? []) {
      const businessId = ctx.businessIds.get(a.business);
      const departmentId = ctx.departmentIds.get(a.dept);
      if (!businessId || !departmentId) continue;
      const [existing] = await db
        .select({ id: schema.assignment.id })
        .from(schema.assignment)
        .where(
          and(
            eq(schema.assignment.membershipId, m.membershipId),
            eq(schema.assignment.departmentId, departmentId),
          ),
        );
      if (existing) continue;
      await db.insert(schema.assignment).values({
        accountId: m.accountId,
        membershipId: m.membershipId,
        businessId,
        departmentId,
        positionId: ctx.positionIds.get(a.position),
        dutyId: a.duty ? ctx.dutyIds.get(a.duty) : null,
        isPrimary: a.primary,
      });
    }
    if (m.accountId !== mainId) continue;
    for (const g of GRANTS[m.email] ?? []) {
      const scopeId =
        g.scope.type === "account"
          ? null
          : g.scope.type === "business"
            ? (ctx.businessIds.get(g.scope.code) ?? null)
            : (ctx.departmentIds.get(g.scope.code) ?? null);
      await db
        .insert(schema.roleGrant)
        .values({
          accountId: m.accountId,
          membershipId: m.membershipId,
          role: g.role,
          scopeType: g.scope.type,
          scopeId,
        })
        .onConflictDoNothing();
    }
  }

  for (const [code, email] of Object.entries(DEPARTMENT_HEADS)) {
    const departmentId = mainOrg.departmentIds.get(code);
    const head = members.find((m) => m.accountId === mainId && m.email === email);
    if (!departmentId || !head) continue;
    await db
      .update(schema.department)
      .set({ headMembershipId: head.membershipId })
      .where(eq(schema.department.id, departmentId));
  }
}

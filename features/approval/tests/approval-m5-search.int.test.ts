// M5-A4 통합 테스트: 문서 검색 (APV-082) — 본문 색인, 금액·기간·상태·양식·부서 조건, 열람 권한 필터 (실제 DB)

import { createDatabase, schema, withTenant } from "@fmerp/db";
import { getTestApp, json, loginAs, type TestClient } from "@fmerp/shared/testing/test-client";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const authDb = createDatabase(process.env.AUTH_DATABASE_URL ?? "");
const appDb = createDatabase(process.env.DATABASE_URL ?? "");
afterAll(async () => {
  await authDb.pool.end();
  await appDb.pool.end();
});

let accountId: string;
let businessId: string;
let finDepartmentId: string;
let salesDepartmentId: string;
let ids: Record<string, string>;
let generalFormId: string;
let searchFormId: string;
const clients: Record<string, TestClient> = {};
const req = (who: string, path: string, method = "GET", body?: unknown) =>
  (clients[who] as TestClient).request(path, {
    method,
    body: body === undefined && method !== "GET" ? {} : body,
  });

interface Page {
  items: { id: string; title: string }[];
  nextCursor: string | null;
}
/** 이 파일의 문서만 보도록 고유 표지를 붙여 검색한다 */
const TAG = `m5s${Math.random().toString(36).slice(2, 7)}`;
const search = async (who: string, query: string) =>
  json<Page>(await req(who, `/api/search?${query}`));
const found = async (who: string, query: string) =>
  (await search(who, query)).items.map((i) => i.title);

const approveStep = (seq: number, email: string) => ({
  type: "approve",
  seq,
  target: { kind: "user", membershipId: ids[email] },
});

async function createDoc(
  title: string,
  body: Record<string, unknown>,
  formId = searchFormId,
  submit = true,
) {
  const res = await req("member1", "/api/approvals", "POST", {
    businessId,
    formId,
    title,
    body,
    line: [approveStep(1, "member2@example.com")],
  });
  if (res.status !== 201) throw new Error(`문서 생성 실패 ${res.status} ${await res.text()}`);
  const { documentId } = await json<{ documentId: string }>(res);
  if (submit) {
    const s = await req("member1", `/api/approvals/${documentId}/submit`, "POST");
    if (s.status !== 200) throw new Error(`상신 실패 ${s.status} ${await s.text()}`);
  }
  return documentId;
}

beforeAll(async () => {
  for (const who of ["member1", "member2", "hr", "admin", "owner", "auditor", "owner-b"]) {
    clients[who] = await loginAs(`${who}@example.com`);
  }
  const [account] = await authDb.db
    .select()
    .from(schema.account)
    .where(eq(schema.account.slug, "fourm-test"));
  accountId = account?.id ?? "";
  const members = await authDb.db
    .select({
      id: schema.membership.id,
      email: schema.user.email,
      accountId: schema.membership.accountId,
    })
    .from(schema.membership)
    .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId));
  ids = Object.fromEntries(
    members.filter((x) => x.accountId === accountId).map((x) => [x.email, x.id]),
  );
  const tenant = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(appDb.db, accountId, fn);
  const businesses = await tenant((tx) => tx.select().from(schema.business));
  businessId = businesses.find((b) => b.code === "FM")?.id ?? "";
  const departments = await tenant((tx) => tx.select().from(schema.department));
  finDepartmentId =
    departments.find((d) => d.businessId === businessId && d.code === "FIN")?.id ?? "";
  salesDepartmentId =
    departments.find((d) => d.businessId === businessId && d.code === "SALES")?.id ?? "";
  const forms = await json<{ id: string; code: string }[]>(await req("member1", "/api/forms"));
  generalFormId = forms.find((f) => f.code === "GENERAL")?.id ?? "";
  const created = await req("admin", "/api/forms", "POST", {
    code: `SRCH${TAG}`.toUpperCase().slice(0, 12),
    name: "검색 시험 양식",
    version: {
      schema: {
        fields: [
          { key: "memo", label: "메모", type: "text", required: true, maxLength: 200 },
          { key: "amount", label: "금액", type: "money", searchAmount: true },
        ],
      },
      defaultLine: [approveStep(1, "member2@example.com")],
      numbering: { rule: "{사업자코드}-{양식코드}-{YYYY}-{SEQ:4}", cycle: "year", at: "complete" },
      retentionYears: 3,
      securityDefault: "normal",
      allowLineEdit: true,
      policy: { disagree: "reject", rejectTo: "drafter", auditCanReject: true },
    },
  });
  expect(created.status).toBe(201);
  searchFormId = (await json<{ formId: string }>(created)).formId;
});

describe("글자 검색 (APV-082)", () => {
  let tripId: string;
  let supplyId: string;

  beforeAll(async () => {
    tripId = await createDoc(`${TAG} 서울 출장`, { memo: "정산 요청 서울 KTX", amount: 125000 });
    // 첨부는 초안일 때만 붙일 수 있어, 상신하기 전에 첨부 행을 넣는다
    supplyId = await createDoc(
      `${TAG} 비품 구매`,
      { memo: "사무용 의자 구매", amount: 30000 },
      searchFormId,
      false,
    );
    await withTenant(appDb.db, accountId, (tx) =>
      tx.insert(schema.attachment).values({
        accountId,
        documentId: supplyId,
        storageKey: `test/${TAG}`,
        filename: `${TAG}-견적서.pdf`,
        size: 10,
        mime: "application/pdf",
        sha256: "a".repeat(64),
        uploadedByMembershipId: ids["member1@example.com"] ?? "",
      }),
    );
    expect((await req("member1", `/api/approvals/${supplyId}/submit`, "POST")).status).toBe(200);
  });

  it("제목으로 찾는다", async () => {
    expect(await found("member1", `q=${encodeURIComponent(`${TAG} 비품`)}`)).toEqual([
      `${TAG} 비품 구매`,
    ]);
  });

  it("상신된 본문 글자로 찾는다", async () => {
    expect(await found("member1", `q=${encodeURIComponent("KTX")}`)).toContain(`${TAG} 서울 출장`);
    expect(await found("member1", `q=${encodeURIComponent("사무용 의자")}`)).toContain(
      `${TAG} 비품 구매`,
    );
  });

  it("문서번호로 찾는다", async () => {
    const detail = await json<{ docNo: string | null }>(
      await req("member1", `/api/approvals/${tripId}`),
    );
    // 채번 시점이 완료 시라 아직 번호가 없다. 완료 후에 찾을 수 있다
    expect(detail.docNo).toBeNull();
    const view = await json<{ steps: { id: string; status: string; version: number }[] }>(
      await req("member1", `/api/approvals/${tripId}`),
    );
    await req("member2", "/api/me/pin", "PUT", { pin: "246810" });
    await req("member2", "/api/me/pin/verify", "POST", { pin: "246810" });
    const step = view.steps.find((s) => s.status === "ACTIVE");
    const done = await req("member2", `/api/approvals/${tripId}/steps/${step?.id}/act`, "POST", {
      action: { kind: "approve" },
      idempotencyKey: `k-${TAG}`,
      expectedVersion: step?.version,
    });
    expect(done.status).toBe(200);
    const after = await json<{ docNo: string }>(await req("member1", `/api/approvals/${tripId}`));
    expect(after.docNo).toMatch(/-\d{4}$/);
    expect(await found("member1", `q=${encodeURIComponent(after.docNo)}`)).toContain(
      `${TAG} 서울 출장`,
    );
  });

  it("첨부 파일명으로 찾는다", async () => {
    expect(await found("member1", `q=${encodeURIComponent(`${TAG}-견적서`)}`)).toEqual([
      `${TAG} 비품 구매`,
    ]);
  });

  it("LIKE 와일드카드는 글자 그대로 찾고 모든 문서에 일치하지 않는다", async () => {
    await createDoc(`${TAG} 100%할인`, { memo: "할인 행사" });
    expect(await found("member1", `q=${encodeURIComponent(`${TAG} 100%`)}`)).toEqual([
      `${TAG} 100%할인`,
    ]);
    expect(await found("member1", `q=${encodeURIComponent(`${TAG} 1_0`)}`)).toEqual([]);
    // 3글자 미만은 제목·문서번호의 앞부분만 본다
    expect(await found("member1", `q=${encodeURIComponent("__")}`)).toEqual([]);
  });

  it("3글자 미만 검색어는 앞부분 일치만 한다", async () => {
    const title = `가나${TAG}`;
    await createDoc(title, { memo: "x" });
    expect(await found("member1", `q=${encodeURIComponent("가나")}`)).toContain(title);
    expect(await found("member1", `q=${encodeURIComponent("나")}`)).not.toContain(title);
  });
});

describe("조건 검색", () => {
  it("금액 범위", async () => {
    const tag = `금액${TAG}`;
    await createDoc(`${tag} 고액`, { memo: tag, amount: 5_000_000 });
    await createDoc(`${tag} 소액`, { memo: tag, amount: 4_000 });
    await createDoc(`${tag} 금액없음`, { memo: tag });
    const base = `q=${encodeURIComponent(tag)}`;
    expect(await found("member1", `${base}&minAmount=1000000`)).toEqual([`${tag} 고액`]);
    expect(await found("member1", `${base}&maxAmount=10000`)).toEqual([`${tag} 소액`]);
    expect((await found("member1", `${base}&minAmount=1000&maxAmount=10000000`)).sort()).toEqual(
      [`${tag} 고액`, `${tag} 소액`].sort(),
    );
    expect(await found("member1", base)).toHaveLength(3);
  });

  it("상태·양식·기안 부서·기안자·기간", async () => {
    const tag = `조건${TAG}`;
    const submitted = await createDoc(`${tag} 상신`, { memo: tag });
    await createDoc(`${tag} 일반양식`, { body: { type: "doc", content: [] } }, generalFormId);
    const base = `q=${encodeURIComponent(tag)}`;
    expect(await found("member1", `${base}&status=IN_PROGRESS`)).toHaveLength(2);
    expect(await found("member1", `${base}&status=COMPLETED`)).toEqual([]);
    expect(await found("member1", `${base}&formId=${searchFormId}`)).toEqual([`${tag} 상신`]);
    expect(await found("member1", `${base}&formId=${generalFormId}`)).toEqual([`${tag} 일반양식`]);
    // 기안자(member1)는 재무팀 소속이다
    expect(await found("member1", `${base}&departmentId=${finDepartmentId}`)).toHaveLength(2);
    expect(await found("member1", `${base}&departmentId=${salesDepartmentId}`)).toEqual([]);
    expect(await found("member1", `${base}&drafter=${encodeURIComponent("박사원")}`)).toHaveLength(
      2,
    );
    expect(await found("member1", `${base}&drafter=${encodeURIComponent("없는사람")}`)).toEqual([]);
    // 상신일은 KST 날짜 기준이다
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    expect(await found("member1", `${base}&from=${today}&to=${today}`)).toHaveLength(2);
    expect(await found("member1", `${base}&from=2000-01-01&to=2000-01-02`)).toEqual([]);
    void submitted;
  });

  it("잘못된 조건은 400이다", async () => {
    for (const q of [
      "status=NOPE",
      "departmentId=abc",
      "formId=abc",
      "from=2026/10/01",
      "minAmount=-1",
      "limit=0",
      "q=",
    ]) {
      expect((await req("member1", `/api/search?${q}`)).status, q).toBe(400);
    }
    expect((await req("member1", "/api/search?cursor=zzz")).status).toBe(400);
  });
});

describe("열람 권한 필터", () => {
  it("관계없는 사람의 검색 결과에는 나타나지 않는다", async () => {
    const tag = `권한${TAG}`;
    await createDoc(`${tag} 비공개`, { memo: `${tag} 본문` });
    const q = `q=${encodeURIComponent(tag)}`;
    expect(await found("member1", q)).toHaveLength(1);
    expect(await found("member2", q)).toHaveLength(1);
    // 결재선에 없는 사람, 계정 관리자는 본문 글자로도 제목으로도 찾을 수 없다
    for (const who of ["hr", "admin"]) expect(await found(who, q), who).toEqual([]);
    // 감사 범위(read_all)가 있는 소유자·감사인은 찾는다
    expect(await found("owner", q)).toHaveLength(1);
    expect(await found("auditor", q)).toHaveLength(1);
    // 다른 회사에서는 찾을 수 없다
    expect(await found("owner-b", q)).toEqual([]);
  });

  it("참조 대상은 상신 후 검색에서 찾고, 초안은 기안자만 찾는다 (본문은 상신 전에는 색인하지 않는다)", async () => {
    const tag = `초안${TAG}`;
    const draft = await createDoc(`${tag} 초안문서`, { memo: `${tag}본문` }, searchFormId, false);
    const q = `q=${encodeURIComponent(tag)}`;
    expect(await found("member1", q)).toEqual([`${tag} 초안문서`]); // 제목은 기안자 본인에게
    expect(await found("member1", `q=${encodeURIComponent(`${tag}본문`)}`)).toEqual([]);
    expect(await found("member2", q)).toEqual([]);
    expect(await found("owner", q)).toEqual([]);
    await req("member1", `/api/approvals/${draft}/recipients`, "PUT", {
      items: [{ kind: "cc", target: { type: "member", id: ids["hr@example.com"] } }],
    });
    expect(await found("hr", q)).toEqual([]);
    expect((await req("member1", `/api/approvals/${draft}/submit`, "POST")).status).toBe(200);
    expect(await found("hr", q)).toEqual([`${tag} 초안문서`]);
    expect(await found("hr", `q=${encodeURIComponent(`${tag}본문`)}`)).toEqual([`${tag} 초안문서`]);
  });
});

describe("흔한 낱말 검색 (덩어리 조회)", () => {
  const COMMON = `흔함${TAG}`;
  const COUNT = 1100; // 후보 상한(1000)을 넘긴다

  beforeAll(async () => {
    await withTenant(appDb.db, accountId, (tx) =>
      tx.execute(sql`insert into document (id, account_id, business_id, drafter_membership_id, title, status, policy, submitted_at, created_at)
        select uuidv7(), ${accountId}::uuid, ${businessId}::uuid, ${ids["member1@example.com"]}::uuid,
               ${COMMON} || ' ' || g, 'IN_PROGRESS',
               '{"disagree":"reject","rejectTo":"drafter","auditCanReject":true}'::jsonb,
               now(), now() - (g || ' seconds')::interval
        from generate_series(1, ${COUNT}) g`),
    );
  });

  it("끝까지 이어서 가져오면 모두 한 번씩 나오고 최근 순이다", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let guard = 0;
    do {
      const page: Page = await search(
        "member1",
        `q=${encodeURIComponent(COMMON)}&limit=100${cursor ? `&cursor=${cursor}` : ""}`,
      );
      seen.push(...page.items.map((i) => i.title));
      cursor = page.nextCursor;
      guard++;
    } while (cursor && guard < 60);
    expect(seen).toHaveLength(COUNT);
    expect(new Set(seen).size).toBe(COUNT);
    // 만든 시각이 최근인 g=1이 먼저 나온다
    expect(seen[0]).toBe(`${COMMON} 1`);
    expect(seen[COUNT - 1]).toBe(`${COMMON} ${COUNT}`);
  });

  it("열람 권한이 없는 사람에게는 한 건도 나오지 않는다", async () => {
    const page = await search("hr", `q=${encodeURIComponent(COMMON)}&limit=100`);
    expect(page.items).toEqual([]);
  });

  it("다른 조건과 함께 써도 덩어리 조회가 맞게 거른다", async () => {
    const page = await search(
      "member1",
      `q=${encodeURIComponent(COMMON)}&status=COMPLETED&limit=100`,
    );
    expect(page.items).toEqual([]);
    const some = await search(
      "member1",
      `q=${encodeURIComponent(COMMON)}&status=IN_PROGRESS&limit=5`,
    );
    expect(some.items).toHaveLength(5);
    expect(some.nextCursor).not.toBeNull();
  });
});

describe("쪽 나누기", () => {
  it("커서로 이어서 가져오며 중복이 없다", async () => {
    const tag = `쪽${TAG}`;
    for (let i = 0; i < 3; i++) await createDoc(`${tag} ${i}`, { memo: tag });
    const seen: string[] = [];
    let cursor: string | null = null;
    let guard = 0;
    do {
      const page: Page = await search(
        "member1",
        `q=${encodeURIComponent(tag)}&limit=2${cursor ? `&cursor=${cursor}` : ""}`,
      );
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      guard++;
    } while (cursor && guard < 10);
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });

  it("로그인하지 않으면 401이다", async () => {
    const app = getTestApp();
    expect((await app.request("/api/search?q=abc")).status).toBe(401);
  });
});

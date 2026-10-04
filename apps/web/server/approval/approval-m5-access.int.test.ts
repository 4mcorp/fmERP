// M5-A4 통합 테스트: 문서 열람 권한(PERM-003), 참조·수신·공람·접수·배부 (APV-070·072·073) (실제 DB)
import { createDatabase, schema, withTenant } from "@fmerp/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, loginAs, type TestClient } from "../test-client";

const authDb = createDatabase(process.env.AUTH_DATABASE_URL ?? "");
const appDb = createDatabase(process.env.DATABASE_URL ?? "");
afterAll(async () => {
  await authDb.pool.end();
  await appDb.pool.end();
});

let accountId: string;
let businessId: string;
let mgtDepartmentId: string;
let ids: Record<string, string>;
let generalFormId: string;
const clients: Record<string, TestClient> = {};
const DOC = { type: "doc", content: [] };
let keySeq = 0;
const key = () => `m5a-${++keySeq}-${Math.random().toString(36).slice(2)}`;
const req = (who: string, path: string, method = "GET", body?: unknown) =>
  (clients[who] as TestClient).request(path, {
    method,
    body: body === undefined && method !== "GET" ? {} : body,
  });

interface View {
  status: string;
  steps: { id: string; status: string; version: number }[];
}
interface RecipientView {
  id: string;
  kind: string;
  targetName: string;
  receivedByName: string | null;
  reads: { name: string }[];
  distributedTo: { name: string }[];
}

const approveStep = (seq: number, email: string) => ({
  type: "approve",
  seq,
  target: { kind: "user", membershipId: ids[email] },
});

async function createDoc(over: Record<string, unknown> = {}) {
  const res = await req("member1", "/api/approvals", "POST", {
    businessId,
    formId: generalFormId,
    title: "M5 열람 테스트",
    body: { body: DOC },
    line: [approveStep(1, "member2@example.com")],
    ...over,
  });
  if (res.status !== 201) throw new Error(`문서 생성 실패 ${res.status} ${await res.text()}`);
  return (await json<{ documentId: string }>(res)).documentId;
}
const status = async (who: string, id: string) => (await req(who, `/api/approvals/${id}`)).status;
const recipients = async (who: string, id: string) =>
  json<RecipientView[]>(await req(who, `/api/approvals/${id}/recipients`));

async function setRecipients(id: string, items: unknown[]) {
  const res = await req("member1", `/api/approvals/${id}/recipients`, "PUT", { items });
  expect(res.status).toBe(200);
}
async function submit(id: string) {
  const res = await req("member1", `/api/approvals/${id}/submit`, "POST");
  if (res.status !== 200) throw new Error(`상신 실패 ${res.status} ${await res.text()}`);
}
async function complete(id: string) {
  const v = await json<View>(await req("member1", `/api/approvals/${id}`));
  const step = v.steps.find((s) => s.status === "ACTIVE");
  const res = await req("member2", `/api/approvals/${id}/steps/${step?.id}/act`, "POST", {
    action: { kind: "approve" },
    idempotencyKey: key(),
    expectedVersion: step?.version,
  });
  if (res.status !== 200) throw new Error(`승인 실패 ${res.status} ${await res.text()}`);
}

const member = (email: string) => ({ type: "member", id: ids[email] });
const dept = () => ({ type: "department", id: mgtDepartmentId });

beforeAll(async () => {
  for (const who of [
    "member1",
    "member2",
    "hr",
    "admin",
    "owner",
    "auditor",
    "bizadmin",
    "approver",
    "multi",
    "owner-b",
  ]) {
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
  const businesses = await withTenant(appDb.db, accountId, (tx) =>
    tx.select().from(schema.business),
  );
  businessId = businesses.find((b) => b.code === "FM")?.id ?? "";
  const departments = await withTenant(appDb.db, accountId, (tx) =>
    tx.select().from(schema.department),
  );
  mgtDepartmentId =
    departments.find((d) => d.businessId === businessId && d.code === "MGT")?.id ?? "";
  const forms = await json<{ id: string; code: string }[]>(await req("member1", "/api/forms"));
  generalFormId = forms.find((f) => f.code === "GENERAL")?.id ?? "";
  for (const who of ["member1", "member2"]) {
    await req(who, "/api/me/pin", "PUT", { pin: "246810" });
    expect((await req(who, "/api/me/pin/verify", "POST", { pin: "246810" })).status).toBe(200);
  }
});

describe("문서 열람 권한 (PERM-003)", () => {
  it("관계없는 사람과 계정 관리자는 문서가 있는지도 알 수 없다 (404)", async () => {
    const id = await createDoc();
    await submit(id);
    for (const who of ["multi", "admin", "bizadmin", "hr", "approver"]) {
      expect(await status(who, id), who).toBe(404);
      // 대상자 명단(수신 부서·접수자·참조자)도 열람 권한이 없으면 알려 주지 않는다
      expect((await req(who, `/api/approvals/${id}/recipients`)).status, who).toBe(404);
    }
  });

  it("소유자·감사인(read_all)은 상신 후 모든 문서를 열람하지만 초안은 볼 수 없다", async () => {
    const id = await createDoc();
    expect(await status("owner", id)).toBe(404);
    expect(await status("auditor", id)).toBe(404);
    await submit(id);
    expect(await status("owner", id)).toBe(200);
    // 감사인은 MGT 부서 범위이고 기안자(member1)는 그 하위 재무팀 소속이다
    expect(await status("auditor", id)).toBe(200);
  });

  it("다른 회사 사용자는 어떤 경우에도 볼 수 없다", async () => {
    const id = await createDoc();
    await submit(id);
    expect(await status("owner-b", id)).toBe(404);
    expect((await req("owner-b", `/api/approvals/${id}/recipients`)).status).toBe(404);
  });
});

describe("참조 (APV-073)", () => {
  it("상신 즉시 참조자가 열람하고, 열람 일시는 기안자에게만 보인다", async () => {
    const id = await createDoc();
    await setRecipients(id, [{ kind: "cc", target: member("hr@example.com") }]);
    expect(await status("hr", id)).toBe(404); // 초안
    await submit(id);
    expect(await status("hr", id)).toBe(200);

    const forDrafter = await recipients("member1", id);
    expect(forDrafter).toHaveLength(1);
    expect(forDrafter[0]?.reads.map((r) => r.name)).toHaveLength(1);
    // 참조자 본인에게는 열람 현황을 보여 주지 않는다
    const forCc = await recipients("hr", id);
    expect(forCc[0]?.reads).toEqual([]);
  });

  it("참조자는 전체 공개 의견만 보고 기안자 전용 의견은 보지 못한다", async () => {
    const id = await createDoc();
    await setRecipients(id, [{ kind: "cc", target: member("hr@example.com") }]);
    await submit(id);
    await req("member1", `/api/approvals/${id}/comments`, "POST", {
      body: "모두 보는 의견",
      visibility: "all",
    });
    await req("member1", `/api/approvals/${id}/comments`, "POST", {
      body: "기안자만 보는 의견",
      visibility: "drafter",
    });
    const list = await json<{ body: string }[]>(await req("hr", `/api/approvals/${id}/comments`));
    expect(list.map((c) => c.body)).toEqual(["모두 보는 의견"]);
  });

  it("회수한 문서의 참조자는 볼 수 없다", async () => {
    const id = await createDoc();
    await setRecipients(id, [{ kind: "cc", target: member("hr@example.com") }]);
    await submit(id);
    expect((await req("member1", `/api/approvals/${id}/withdraw`, "POST")).status).toBe(200);
    expect(await status("hr", id)).toBe(404);
  });
});

describe("지정 규칙", () => {
  it("기안자만, 초안에서만 지정할 수 있다", async () => {
    const id = await createDoc();
    const items = [{ kind: "cc", target: member("hr@example.com") }];
    expect((await req("hr", `/api/approvals/${id}/recipients`, "PUT", { items })).status).toBe(404);
    await submit(id);
    expect((await req("member1", `/api/approvals/${id}/recipients`, "PUT", { items })).status).toBe(
      409,
    );
  });

  it("수신 대상은 부서만 가능하다", async () => {
    const id = await createDoc();
    const res = await req("member1", `/api/approvals/${id}/recipients`, "PUT", {
      items: [{ kind: "receive", target: member("hr@example.com") }],
    });
    expect(res.status).toBe(400);
  });

  it("같은 대상을 중복 지정해도 한 건만 저장하고, 다시 지정하면 통째로 바뀐다", async () => {
    const id = await createDoc();
    const cc = { kind: "cc", target: member("hr@example.com") };
    await setRecipients(id, [cc, cc]);
    expect(await recipients("member1", id)).toHaveLength(1);
    await setRecipients(id, []);
    expect(await recipients("member1", id)).toHaveLength(0);
  });
});

describe("수신 접수·배부 (APV-070)", () => {
  async function receivedDoc() {
    const id = await createDoc();
    await setRecipients(id, [{ kind: "receive", target: dept() }]);
    await submit(id);
    return id;
  }

  it("접수 전에는 수신 부서장도 문서를 볼 수 없고, 완료 전에는 접수할 수 없다", async () => {
    const id = await receivedDoc();
    const [r] = await recipients("member1", id);
    expect(await status("bizadmin", id)).toBe(404);
    // 완료 전: 담당자(부서장)에게는 상태 오류(409)
    expect((await req("bizadmin", `/api/recipients/${r?.id}/receive`, "POST")).status).toBe(409);
  });

  it("완료 후 부서장이 접수하면 열람할 수 있고, 두 번째 접수는 거부된다", async () => {
    const id = await receivedDoc();
    await complete(id);
    const [r] = await recipients("member1", id);
    // 접수 담당자(부서장)는 접수 전에도 내용을 열어 보고 접수한다. 같은 부서의 다른 사람은 접수 뒤에야 본다
    expect(await status("bizadmin", id)).toBe(200);
    const forHead = await recipients("bizadmin", id);
    expect(forHead[0]).toMatchObject({ canReceive: true, canDistribute: false });
    // 부서장이 아닌 사람(read_all이 있어도)은 접수 건이 있는지도 알 수 없다
    expect((await req("auditor", `/api/recipients/${r?.id}/receive`, "POST")).status).toBe(404);
    expect((await req("bizadmin", `/api/recipients/${r?.id}/receive`, "POST")).status).toBe(200);
    expect(await status("bizadmin", id)).toBe(200);
    expect((await req("bizadmin", `/api/recipients/${r?.id}/receive`, "POST")).status).toBe(409);
    const after = await recipients("member1", id);
    expect(after[0]?.receivedByName).not.toBeNull();
  });

  it("접수자는 수신 부서 구성원에게만 배부할 수 있다", async () => {
    const id = await receivedDoc();
    await complete(id);
    const [r] = await recipients("member1", id);
    await req("bizadmin", `/api/recipients/${r?.id}/receive`, "POST");
    const body = (email: string) => ({ membershipIds: [ids[email]] });
    // 재무팀 소속은 수신 부서(경영지원본부) 소속이 아니다
    expect(
      (
        await req(
          "bizadmin",
          `/api/recipients/${r?.id}/distribute`,
          "POST",
          body("member1@example.com"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await req(
          "bizadmin",
          `/api/recipients/${r?.id}/distribute`,
          "POST",
          body("owner@example.com"),
        )
      ).status,
    ).toBe(200);
    // 접수자가 아닌 사람은 배부할 수 없다
    expect(
      (
        await req(
          "auditor",
          `/api/recipients/${r?.id}/distribute`,
          "POST",
          body("owner@example.com"),
        )
      ).status,
    ).toBe(404);
    const after = await recipients("member1", id);
    expect(after[0]?.distributedTo).toHaveLength(1);
  });

  it("다른 회사 사용자는 접수·배부 API에서 수신 건을 볼 수 없다", async () => {
    const id = await receivedDoc();
    await complete(id);
    const [r] = await recipients("member1", id);
    expect((await req("owner-b", `/api/recipients/${r?.id}/receive`, "POST")).status).toBe(404);
    expect(
      (
        await req("owner-b", `/api/recipients/${r?.id}/distribute`, "POST", {
          membershipIds: [ids["owner@example.com"]],
        })
      ).status,
    ).toBe(404);
  });
});

describe("공람 (APV-072)", () => {
  it("완료된 문서만 공람으로 회람하고, 지정된 사람은 열람하며 열람 일시가 남는다", async () => {
    const id = await createDoc();
    await submit(id);
    const targets = [member("approver@example.com")];
    expect(
      (await req("member1", `/api/approvals/${id}/circulate`, "POST", { targets })).status,
    ).toBe(409);
    await complete(id);
    expect(await status("approver", id)).toBe(404);
    expect((await req("hr", `/api/approvals/${id}/circulate`, "POST", { targets })).status).toBe(
      404,
    );
    const res = await req("member1", `/api/approvals/${id}/circulate`, "POST", { targets });
    expect(res.status).toBe(200);
    expect((await json<{ added: number }>(res)).added).toBe(1);
    // 같은 대상을 다시 지정해도 늘지 않는다
    const again = await req("member1", `/api/approvals/${id}/circulate`, "POST", { targets });
    expect((await json<{ added: number }>(again)).added).toBe(0);
    expect(await status("approver", id)).toBe(200);
    const list = await recipients("member1", id);
    expect(list).toHaveLength(1);
    expect(list[0]?.reads).toHaveLength(1);
  });
});

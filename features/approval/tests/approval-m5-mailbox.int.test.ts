// M5-A4 통합 테스트: 개인·부서·감사 문서함 (APV-080·081), 커서 페이지네이션 (실제 DB)

import { createDatabase, schema, withTenant } from "@fmerp/db";
import { getTestApp, json, loginAs, type TestClient } from "@fmerp/shared/testing/test-client";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const authDb = createDatabase(process.env.AUTH_DATABASE_URL ?? "");
const appDb = createDatabase(process.env.DATABASE_URL ?? "");
afterAll(async () => {
  await authDb.pool.end();
  await appDb.pool.end();
});

let businessId: string;
let mgtDepartmentId: string;
let ids: Record<string, string>;
let generalFormId: string;
const clients: Record<string, TestClient> = {};
const DOC = { type: "doc", content: [] };
let keySeq = 0;
const key = () => `m5b-${++keySeq}-${Math.random().toString(36).slice(2)}`;
const req = (who: string, path: string, method = "GET", body?: unknown) =>
  (clients[who] as TestClient).request(path, {
    method,
    body: body === undefined && method !== "GET" ? {} : body,
  });

interface Page {
  items: { id: string; title: string; status: string; read: boolean }[];
  nextCursor: string | null;
}
const box = async (who: string, name: string, query = "") =>
  json<Page>(await req(who, `/api/mailbox/${name}${query}`));
const inBox = async (who: string, name: string, id: string) =>
  (await box(who, name, "?limit=100")).items.some((i) => i.id === id);

const step = (seq: number, email: string) => ({
  type: "approve",
  seq,
  target: { kind: "user", membershipId: ids[email] },
});
const member = (email: string) => ({ type: "member", id: ids[email] });

async function createDoc(
  line: unknown[] = [step(1, "member2@example.com")],
  title = "문서함 테스트",
) {
  const res = await req("member1", "/api/approvals", "POST", {
    businessId,
    formId: generalFormId,
    title,
    body: { body: DOC },
    line,
  });
  if (res.status !== 201) throw new Error(`문서 생성 실패 ${res.status} ${await res.text()}`);
  return (await json<{ documentId: string }>(res)).documentId;
}
const submit = async (id: string) => {
  const res = await req("member1", `/api/approvals/${id}/submit`, "POST");
  if (res.status !== 200) throw new Error(`상신 실패 ${res.status} ${await res.text()}`);
};
async function approveAs(who: string, id: string) {
  const v = await json<{ steps: { id: string; status: string; version: number }[] }>(
    await req("member1", `/api/approvals/${id}`),
  );
  const s = v.steps.find((x) => x.status === "ACTIVE");
  const res = await req(who, `/api/approvals/${id}/steps/${s?.id}/act`, "POST", {
    action: { kind: "approve" },
    idempotencyKey: key(),
    expectedVersion: s?.version,
  });
  if (res.status !== 200) throw new Error(`승인 실패 ${res.status} ${await res.text()}`);
}

beforeAll(async () => {
  for (const who of [
    "member1",
    "member2",
    "hr",
    "admin",
    "owner",
    "auditor",
    "bizadmin",
    "owner-b",
  ]) {
    clients[who] = await loginAs(`${who}@example.com`);
  }
  const [account] = await authDb.db
    .select()
    .from(schema.account)
    .where(eq(schema.account.slug, "fourm-test"));
  const accountId = account?.id ?? "";
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
  for (const who of ["member1", "member2", "hr"]) {
    await req(who, "/api/me/pin", "PUT", { pin: "246810" });
    expect((await req(who, "/api/me/pin/verify", "POST", { pin: "246810" })).status).toBe(200);
  }
});

describe("개인 문서함 (APV-080)", () => {
  it("기안함은 초안을 포함하되 다른 사람 함에는 초안이 나타나지 않는다", async () => {
    const draft = await createDoc();
    expect(await inBox("member1", "mine", draft)).toBe(true);
    for (const who of ["member2", "owner", "auditor"]) {
      for (const name of ["mine", "progress", "upcoming", "audit"]) {
        if (name === "audit" && who !== "owner" && who !== "auditor") continue;
        expect(await inBox(who, name, draft), `${who}/${name}`).toBe(false);
      }
    }
  });

  it("결재 예정·진행 중·완료함이 결재 진행에 따라 옮겨 간다", async () => {
    const id = await createDoc([step(1, "member2@example.com"), step(2, "hr@example.com")]);
    await submit(id);
    // member2는 지금 내 차례(결재 대기), hr는 결재 예정
    expect(await inBox("hr", "upcoming", id)).toBe(true);
    expect(await inBox("member2", "upcoming", id)).toBe(false);
    for (const who of ["member1", "member2", "hr"]) {
      expect(await inBox(who, "progress", id), who).toBe(true);
      expect(await inBox(who, "completed", id), who).toBe(false);
    }
    await approveAs("member2", id);
    expect(await inBox("hr", "upcoming", id)).toBe(false);
    await approveAs("hr", id);
    for (const who of ["member1", "member2", "hr"]) {
      expect(await inBox(who, "progress", id), who).toBe(false);
      expect(await inBox(who, "completed", id), who).toBe(true);
    }
    // 관여하지 않은 사람의 함에는 없다
    expect(await inBox("bizadmin", "completed", id)).toBe(false);
  });

  it("참조함: 상신 즉시 설정이면 진행 중에도 보이고, 회수하면 사라진다", async () => {
    const id = await createDoc();
    await req("member1", `/api/approvals/${id}/recipients`, "PUT", {
      items: [{ kind: "cc", target: member("hr@example.com") }],
    });
    expect(await inBox("hr", "cc", id)).toBe(false); // 초안
    await submit(id);
    expect(await inBox("hr", "cc", id)).toBe(true);
    await req("member1", `/api/approvals/${id}/withdraw`, "POST");
    expect(await inBox("hr", "cc", id)).toBe(false);
  });

  it("수신함: 접수 전에는 담당자(부서장)에게만, 접수 후에는 접수자에게 보인다", async () => {
    const id = await createDoc();
    await req("member1", `/api/approvals/${id}/recipients`, "PUT", {
      items: [{ kind: "receive", target: { type: "department", id: mgtDepartmentId } }],
    });
    await submit(id);
    expect(await inBox("bizadmin", "receive", id)).toBe(false); // 완료 전
    await approveAs("member2", id);
    expect(await inBox("bizadmin", "receive", id)).toBe(true);
    expect(await inBox("owner", "receive", id)).toBe(false); // 같은 부서지만 접수 전
    const recipients = await json<{ id: string }[]>(
      await req("member1", `/api/approvals/${id}/recipients`),
    );
    await req("bizadmin", `/api/recipients/${recipients[0]?.id}/receive`, "POST");
    // 접수 후에는 일반 문서면 수신 부서원 전체에게도 보인다
    expect(await inBox("owner", "receive", id)).toBe(true);
    expect(await inBox("bizadmin", "dept", id)).toBe(true);
  });

  it("공람함: 완료 후 회람한 대상에게만 보인다", async () => {
    const id = await createDoc();
    await submit(id);
    await approveAs("member2", id);
    expect(await inBox("hr", "circulate", id)).toBe(false);
    await req("member1", `/api/approvals/${id}/circulate`, "POST", {
      targets: [member("hr@example.com")],
    });
    expect(await inBox("hr", "circulate", id)).toBe(true);
  });

  it("부서 문서함: 같은 부서에서 기안한 완료 문서 중 관여한 문서가 보인다", async () => {
    const id = await createDoc();
    await submit(id);
    await approveAs("member2", id);
    // member1·member2는 재무팀 소속이다
    expect(await inBox("member2", "dept", id)).toBe(true);
    expect(await inBox("hr", "dept", id)).toBe(false);
  });

  it("후결·후열함은 비어 있어도 오류 없이 열린다", async () => {
    expect((await req("member1", "/api/mailbox/post")).status).toBe(200);
  });
});

describe("감사함 (APV-081)", () => {
  it("감사 범위(read_all)가 있는 소유자·감사인만 열 수 있다", async () => {
    const id = await createDoc();
    await submit(id);
    expect(await inBox("owner", "audit", id)).toBe(true);
    // 감사인은 MGT 부서 범위이고 기안자는 그 하위 재무팀 소속이다
    expect(await inBox("auditor", "audit", id)).toBe(true);
    for (const who of ["admin", "hr", "bizadmin", "member2"]) {
      expect((await req(who, "/api/mailbox/audit")).status, who).toBe(403);
    }
  });

  it("다른 회사의 소유자는 우리 회사 문서를 감사함에서 볼 수 없다", async () => {
    const id = await createDoc();
    await submit(id);
    const page = await box("owner-b", "audit", "?limit=100");
    expect(page.items.some((i) => i.id === id)).toBe(false);
    expect(await inBox("owner-b", "mine", id)).toBe(false);
  });
});

describe("커서 페이지네이션", () => {
  it("최근 순으로 쪽을 넘기며 중복·누락이 없다", async () => {
    const created: string[] = [];
    for (let i = 0; i < 3; i++) created.push(await createDoc(undefined, `페이지 ${i}`));
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Page = await box(
        "member1",
        "mine",
        `?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 200);
    expect(new Set(seen).size).toBe(seen.length);
    // 최근에 만든 문서가 먼저 나온다 (UUIDv7 순서)
    const order = created.map((id) => seen.indexOf(id));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => b - a));
  });

  it("잘못된 커서·범위를 벗어난 limit은 400이다", async () => {
    expect((await req("member1", "/api/mailbox/mine?cursor=zzz")).status).toBe(400);
    expect((await req("member1", "/api/mailbox/mine?limit=0")).status).toBe(400);
    expect((await req("member1", "/api/mailbox/mine?limit=1000")).status).toBe(400);
    expect((await req("member1", "/api/mailbox/없는함")).status).toBe(400);
  });

  it("로그인하지 않으면 401이다", async () => {
    const app = getTestApp();
    const res = await app.request("/api/mailbox/mine");
    expect(res.status).toBe(401);
  });
});

describe("문서함 읽음 표시 (R8)", () => {
  it("결재 문서는 상세를 열기 전까지 안 읽음이고, 연 뒤 읽음이 된다", async () => {
    const id = await createDoc([step(1, "member2@example.com")], "읽음 표시 테스트");
    await submit(id);
    const flag = async (who: string) =>
      (await box(who, "progress", "?limit=100")).items.find((i) => i.id === id)?.read;
    expect(await flag("member2")).toBe(false);
    expect((await req("member2", `/api/approvals/${id}`)).status).toBe(200);
    expect(await flag("member2")).toBe(true);
  });
});

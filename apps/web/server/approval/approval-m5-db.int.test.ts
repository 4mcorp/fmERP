// M5-A3 통합 테스트: 완료 패키지·수신·공람·검색 테이블의 격리와 불변성, 결재자 이관 함수, 패키지 스윕 함수 (실제 DB)
import { createDatabase, schema, withTenant } from "@fmerp/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, loginAs, type TestClient } from "../test-client";

const authDb = createDatabase(process.env.AUTH_DATABASE_URL ?? "");
const appDb = createDatabase(process.env.DATABASE_URL ?? "");
afterAll(async () => {
  await authDb.pool.end();
  await appDb.pool.end();
});

type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];

let accountId: string;
let otherAccountId: string;
let businessId: string;
let departmentId: string;
let ids: Record<string, string>;
let member1: TestClient;
let member2: TestClient;
let generalFormId: string;
const DOC = { type: "doc", content: [] };
let keySeq = 0;
const key = () => `m5db-${++keySeq}-${Math.random().toString(36).slice(2)}`;
const post = (c: TestClient, path: string, body?: unknown) =>
  c.request(path, { method: "POST", body: body ?? {} });

interface View {
  id: string;
  status: string;
  steps: { id: string; status: string; version: number }[];
}

const tenant = <T>(fn: (tx: Tx) => Promise<T>, account = accountId) =>
  withTenant(appDb.db, account, fn);

/** 실패 메시지를 돌려준다 (성공하면 null). drizzle은 DB 오류를 cause에 담는다 */
async function failure(fn: (tx: Tx) => Promise<unknown>, account = accountId) {
  try {
    await tenant(fn, account);
    return null;
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    return err.cause?.message ?? err.message ?? String(e);
  }
}

async function createDoc(line: unknown[] = [approveStep(1, "member2@example.com")]) {
  const res = await post(member1, "/api/approvals", {
    businessId,
    formId: generalFormId,
    title: "M5 DB 테스트",
    body: { body: DOC },
    line,
  });
  if (res.status !== 201) throw new Error(`문서 생성 실패 ${res.status} ${await res.text()}`);
  return (await json<{ documentId: string }>(res)).documentId;
}
const approveStep = (seq: number, email: string) => ({
  type: "approve",
  seq,
  target: { kind: "user", membershipId: ids[email] },
});
const view = async (id: string) => json<View>(await member1.request(`/api/approvals/${id}`));

async function submit(id: string) {
  const res = await post(member1, `/api/approvals/${id}/submit`);
  if (res.status !== 200) throw new Error(`상신 실패 ${res.status} ${await res.text()}`);
}

async function approveActive(id: string, c: TestClient) {
  const v = await view(id);
  const step = v.steps.find((s) => s.status === "ACTIVE");
  const res = await c.request(`/api/approvals/${id}/steps/${step?.id}/act`, {
    method: "POST",
    body: {
      action: { kind: "approve" },
      idempotencyKey: key(),
      expectedVersion: step?.version,
    },
  });
  if (res.status !== 200) throw new Error(`승인 실패 ${res.status} ${await res.text()}`);
}

async function completedDoc() {
  const id = await createDoc();
  await submit(id);
  await approveActive(id, member2);
  expect((await view(id)).status).toBe("COMPLETED");
  return id;
}

beforeAll(async () => {
  [member1, member2] = await Promise.all([
    loginAs("member1@example.com"),
    loginAs("member2@example.com"),
  ]);
  const [account] = await authDb.db
    .select()
    .from(schema.account)
    .where(eq(schema.account.slug, "fourm-test"));
  accountId = account?.id ?? "";
  const [other] = await authDb.db
    .select()
    .from(schema.account)
    .where(eq(schema.account.slug, "other-company"));
  otherAccountId = other?.id ?? "";
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
  const businesses = await tenant((tx) => tx.select().from(schema.business));
  businessId = businesses.find((b) => b.code === "FM")?.id ?? "";
  const departments = await tenant((tx) => tx.select().from(schema.department));
  departmentId = departments.find((d) => d.businessId === businessId)?.id ?? "";
  const forms = await json<{ id: string; code: string }[]>(await member1.request("/api/forms"));
  generalFormId = forms.find((f) => f.code === "GENERAL")?.id ?? "";
  for (const c of [member1, member2]) {
    await c.request("/api/me/pin", { method: "PUT", body: { pin: "246810" } });
    expect((await post(c, "/api/me/pin/verify", { pin: "246810" })).status).toBe(200);
  }
});

describe("테넌트 격리 (PERM-002) — M5 테이블", () => {
  const tables = {
    document_package: schema.documentPackage,
    document_recipient: schema.documentRecipient,
    document_recipient_read: schema.documentRecipientRead,
    document_distribution: schema.documentDistribution,
    document_search: schema.documentSearch,
  } as const;

  for (const [name, table] of Object.entries(tables)) {
    it(`${name}: 테넌트를 지정하지 않으면 0행이고 다른 계정에는 보이지 않는다`, async () => {
      // 먼저 이 계정에 한 행 이상 있는 상태를 만든다 (document_search로 대표)
      const id = await createDoc();
      await tenant(async (tx) => {
        await tx
          .insert(schema.documentSearch)
          .values({ documentId: id, accountId, body: "격리 확인" })
          .onConflictDoNothing();
        await tx
          .insert(schema.documentPackage)
          .values({ documentId: id, accountId })
          .onConflictDoNothing();
      });
      expect(await appDb.db.select().from(table)).toHaveLength(0);
      expect(await tenant((tx) => tx.select().from(table), otherAccountId)).toHaveLength(0);
    });
  }

  it("다른 계정 문서에 대한 패키지·검색 행은 만들 수 없다", async () => {
    const id = await createDoc();
    const msg = await failure(
      (tx) => tx.insert(schema.documentSearch).values({ documentId: id, accountId, body: "침투" }),
      otherAccountId,
    );
    expect(msg).toMatch(/row-level security|violates/);
  });
});

describe("완료 패키지 상태 (BAK-003)", () => {
  it("READY 조건 제약: READY는 해시와 시각이 함께 있어야 한다", async () => {
    const id = await createDoc();
    const msg = await failure((tx) =>
      tx.insert(schema.documentPackage).values({ documentId: id, accountId, status: "READY" }),
    );
    expect(msg).toMatch(/document_package_ready/);
  });

  it("READY가 된 뒤에는 해시·상태를 바꿀 수 없다", async () => {
    const id = await createDoc();
    await tenant((tx) => tx.insert(schema.documentPackage).values({ documentId: id, accountId }));
    await tenant((tx) =>
      tx
        .update(schema.documentPackage)
        .set({ status: "READY", manifestHash: "a".repeat(64), readyAt: new Date() })
        .where(eq(schema.documentPackage.documentId, id)),
    );
    const msg = await failure((tx) =>
      tx
        .update(schema.documentPackage)
        .set({ manifestHash: "b".repeat(64) })
        .where(eq(schema.documentPackage.documentId, id)),
    );
    expect(msg).toMatch(/완료된 패키지 정보는 변경할 수 없습니다/);
  });

  it("PENDING 동안에는 시도 횟수·오류를 갱신할 수 있다", async () => {
    const id = await createDoc();
    await tenant((tx) => tx.insert(schema.documentPackage).values({ documentId: id, accountId }));
    const msg = await failure((tx) =>
      tx
        .update(schema.documentPackage)
        .set({ attempts: 1, lastError: "S3 시간 초과" })
        .where(eq(schema.documentPackage.documentId, id)),
    );
    expect(msg).toBeNull();
  });
});

describe("참조·수신·공람 (APV-070·072·073)", () => {
  const recipient = (
    id: string,
    over: Partial<typeof schema.documentRecipient.$inferInsert> = {},
  ) => ({
    documentId: id,
    accountId,
    kind: "cc" as const,
    targetMembershipId: ids["hr@example.com"],
    ...over,
  });

  it("초안에서는 지정·삭제할 수 있다", async () => {
    const id = await createDoc();
    const msg = await failure(async (tx) => {
      const [row] = await tx.insert(schema.documentRecipient).values(recipient(id)).returning();
      await tx
        .delete(schema.documentRecipient)
        .where(eq(schema.documentRecipient.id, row?.id ?? ""));
    });
    expect(msg).toBeNull();
  });

  it("상신 뒤에는 추가·삭제·대상 변경이 거부된다 (접수 제외)", async () => {
    const id = await createDoc();
    const [row] = await tenant((tx) =>
      tx
        .insert(schema.documentRecipient)
        .values([
          recipient(id),
          recipient(id, {
            kind: "receive",
            targetMembershipId: null,
            targetDepartmentId: departmentId,
          }),
        ])
        .returning(),
    );
    await submit(id);
    expect(
      await failure((tx) => tx.insert(schema.documentRecipient).values(recipient(id))),
    ).toMatch(/초안에서만/);
    expect(
      await failure((tx) =>
        tx.delete(schema.documentRecipient).where(eq(schema.documentRecipient.id, row?.id ?? "")),
      ),
    ).toMatch(/삭제할 수 없습니다/);
    expect(
      await failure((tx) =>
        tx
          .update(schema.documentRecipient)
          .set({ targetMembershipId: ids["approver@example.com"] })
          .where(eq(schema.documentRecipient.id, row?.id ?? "")),
      ),
    ).toMatch(/바꿀 수 없습니다/);
  });

  it("접수는 한 번만 할 수 있고, 접수자·일시가 함께 있어야 한다", async () => {
    const id = await createDoc();
    const [row] = await tenant((tx) =>
      tx
        .insert(schema.documentRecipient)
        .values(
          recipient(id, {
            kind: "receive",
            targetMembershipId: null,
            targetDepartmentId: departmentId,
          }),
        )
        .returning(),
    );
    await submit(id);
    const where = eq(schema.documentRecipient.id, row?.id ?? "");
    expect(
      await failure((tx) =>
        tx
          .update(schema.documentRecipient)
          .set({ receivedByMembershipId: ids["hr@example.com"] })
          .where(where),
      ),
    ).toMatch(/document_recipient_received/);
    expect(
      await failure((tx) =>
        tx
          .update(schema.documentRecipient)
          .set({ receivedByMembershipId: ids["hr@example.com"], receivedAt: new Date() })
          .where(where),
      ),
    ).toBeNull();
    expect(
      await failure((tx) =>
        tx
          .update(schema.documentRecipient)
          .set({ receivedByMembershipId: ids["approver@example.com"], receivedAt: new Date() })
          .where(where),
      ),
    ).toMatch(/바꿀 수 없습니다/);
  });

  it("공람은 완료된 문서에도 지정할 수 있지만 참조·수신은 안 된다", async () => {
    const id = await completedDoc();
    expect(
      await failure((tx) =>
        tx.insert(schema.documentRecipient).values(recipient(id, { kind: "circulate" })),
      ),
    ).toBeNull();
    expect(
      await failure((tx) => tx.insert(schema.documentRecipient).values(recipient(id))),
    ).toMatch(/초안에서만/);
  });

  it("대상 제약: 구성원·부서 중 하나만, 수신은 부서만", async () => {
    const id = await createDoc();
    expect(
      await failure((tx) =>
        tx
          .insert(schema.documentRecipient)
          .values(recipient(id, { targetDepartmentId: departmentId })),
      ),
    ).toMatch(/document_recipient_target/);
    expect(
      await failure((tx) =>
        tx.insert(schema.documentRecipient).values(recipient(id, { kind: "receive" })),
      ),
    ).toMatch(/document_recipient_receive_department/);
  });
});

describe("결재자 이관 함수 (ADM-005)", () => {
  const transfer = (stepId: string, to: string[], account = accountId) =>
    failure(
      (tx) =>
        tx.execute(
          sql`select transfer_step_assignees(${stepId}::uuid, ${`{${to.join(",")}}`}::uuid[], '[]'::jsonb)`,
        ),
      account,
    );

  it("앱 계정이 직접 UPDATE로 처리자를 바꾸면 거부된다", async () => {
    const id = await createDoc();
    await submit(id);
    const step = (await view(id)).steps[0];
    const msg = await failure((tx) =>
      tx
        .update(schema.approvalStep)
        .set({ assigneeIds: [ids["hr@example.com"] ?? ""] })
        .where(eq(schema.approvalStep.id, step?.id ?? "")),
    );
    expect(msg).toMatch(/결재선 구성은 바꿀 수 없습니다/);
  });

  it("진행 중 처리 전 단계의 처리자를 바꾸고 version을 올린다", async () => {
    const id = await createDoc();
    await submit(id);
    const step = (await view(id)).steps[0];
    expect(await transfer(step?.id ?? "", [ids["hr@example.com"] ?? ""])).toBeNull();
    const [row] = await tenant((tx) =>
      tx
        .select()
        .from(schema.approvalStep)
        .where(eq(schema.approvalStep.id, step?.id ?? "")),
    );
    expect(row?.assigneeIds).toEqual([ids["hr@example.com"]]);
    expect(row?.version).toBe((step?.version ?? 0) + 1);
    // 이전 처리자는 더 이상 참여자가 아니어서 문서가 보이지 않는다
    const stale = await member2.request(`/api/approvals/${id}`);
    expect(stale.status).toBe(404);
    // 새 처리자가 이관 전 version으로 처리하려 하면 충돌한다 (APV-045)
    const hr = await loginAs("hr@example.com");
    await hr.request("/api/me/pin", { method: "PUT", body: { pin: "246810" } });
    expect((await post(hr, "/api/me/pin/verify", { pin: "246810" })).status).toBe(200);
    const res = await hr.request(`/api/approvals/${id}/steps/${step?.id}/act`, {
      method: "POST",
      body: {
        action: { kind: "approve" },
        idempotencyKey: key(),
        expectedVersion: step?.version,
      },
    });
    expect(res.status).toBe(409);
  });

  it("처리된 단계·완료 문서·초안은 이관할 수 없다", async () => {
    const done = await completedDoc();
    const doneStep = (await view(done)).steps[0];
    expect(await transfer(doneStep?.id ?? "", [ids["hr@example.com"] ?? ""])).toMatch(
      /처리 전 단계만/,
    );
    const draft = await createDoc();
    const draftStep = (await view(draft)).steps[0];
    expect(await transfer(draftStep?.id ?? "", [ids["hr@example.com"] ?? ""])).toMatch(
      /처리 전 단계만/,
    );
  });

  it("다른 계정의 단계는 찾을 수 없고, 다른 계정 구성원은 처리자가 될 수 없다", async () => {
    const id = await createDoc();
    await submit(id);
    const step = (await view(id)).steps[0];
    expect(await transfer(step?.id ?? "", [ids["hr@example.com"] ?? ""], otherAccountId)).toMatch(
      /찾을 수 없습니다/,
    );
    const [outsider] = await authDb.db
      .select({ id: schema.membership.id })
      .from(schema.membership)
      .where(eq(schema.membership.accountId, otherAccountId));
    expect(await transfer(step?.id ?? "", [outsider?.id ?? ""])).toMatch(/같은 계정의 구성원만/);
  });

  it("테넌트를 지정하지 않으면 실행할 수 없다", async () => {
    await expect(
      appDb.pool.query(
        "select transfer_step_assignees('00000000-0000-0000-0000-000000000000', '{}', '[]')",
      ),
    ).rejects.toThrow(/계정이 지정되지 않았습니다/);
  });
});

describe("패키지 스윕 함수 (ADR 0009)", () => {
  const sweep = async () => {
    const { rows } = await appDb.pool.query<{ account_id: string; document_id: string }>(
      "select * from pending_package_documents(500, interval '0 seconds')",
    );
    return rows;
  };

  it("패키지가 없는 완료 문서의 id만 돌려주고, READY·초안·진행 중 문서는 제외한다", async () => {
    const pending = await completedDoc();
    const ready = await completedDoc();
    await tenant(async (tx) => {
      await tx.insert(schema.documentPackage).values({ documentId: ready, accountId });
      await tx
        .update(schema.documentPackage)
        .set({ status: "READY", manifestHash: "c".repeat(64), readyAt: new Date() })
        .where(eq(schema.documentPackage.documentId, ready));
    });
    const draft = await createDoc();
    const progress = await createDoc();
    await submit(progress);

    const rows = await sweep();
    const found = rows.map((r) => r.document_id);
    expect(found).toContain(pending);
    expect(found).not.toContain(ready);
    expect(found).not.toContain(draft);
    expect(found).not.toContain(progress);
    expect(rows.find((r) => r.document_id === pending)?.account_id).toBe(accountId);
    // 내용 열은 돌려주지 않는다
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["account_id", "document_id"]);
  });

  it("시도 횟수가 10번을 넘은 PENDING은 더 이상 재시도하지 않는다", async () => {
    const id = await completedDoc();
    await tenant((tx) =>
      tx.insert(schema.documentPackage).values({ documentId: id, accountId, attempts: 10 }),
    );
    expect((await sweep()).map((r) => r.document_id)).not.toContain(id);
  });
});

describe("검색 인덱스·열 (APV-082)", () => {
  it("trigram 인덱스와 amount 열이 만들어진다", async () => {
    const { rows } = await appDb.pool.query<{ indexname: string }>(
      "select indexname from pg_indexes where indexname like '%trgm_idx' order by indexname",
    );
    expect(rows.map((r) => r.indexname)).toEqual([
      "attachment_filename_trgm_idx",
      "document_doc_no_trgm_idx",
      "document_search_body_trgm_idx",
      "document_title_trgm_idx",
    ]);
    const col = await appDb.pool.query(
      "select data_type from information_schema.columns where table_name='document' and column_name='amount'",
    );
    expect(col.rows[0]?.data_type).toBe("bigint");
  });
});

import { createDatabase, schema, withTenant } from "@fmerp/db";
import { getTestApp, json, loginAs, type TestClient } from "@fmerp/shared/testing/test-client";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

const appDb = createDatabase(process.env.DATABASE_URL ?? "");
const authDb = createDatabase(process.env.AUTH_DATABASE_URL ?? "");
afterAll(async () => {
  await appDb.pool.end();
  await authDb.pool.end();
});

const definition = {
  schema: { fields: [{ type: "text", key: "subject", label: "제목" }] },
  layout: { blocks: [{ kind: "field", key: "subject" }] },
  defaultLine: [],
  numbering: null,
  retentionYears: 3,
  securityDefault: "normal",
  allowLineEdit: true,
  policy: { disagree: "reject", rejectTo: "drafter", auditCanReject: false },
};
let owner: TestClient;
let admin: TestClient;
let member: TestClient;
let other: TestClient;
let bizadmin: TestClient;
let formId: string;
beforeAll(async () => {
  [owner, admin, member, other, bizadmin] = await Promise.all([
    loginAs("owner@example.com"),
    loginAs("admin@example.com"),
    loginAs("member1@example.com"),
    loginAs("owner-b@example.com"),
    loginAs("bizadmin@example.com"),
  ]);
});
beforeEach(async () => {
  const response = await owner.request("/api/forms", {
    method: "POST",
    body: { code: `draft-${Date.now()}`, name: "초안 시험", version: definition },
  });
  expect(response.status).toBe(201);
  formId = (await json<{ formId: string }>(response)).formId;
});

it("초안이 없으면 null, 자동 저장 후 조회되지만 공개 버전은 그대로다", async () => {
  const path = `/api/forms/${formId}/draft`;
  const empty = await owner.request(path);
  expect(empty.status).toBe(200);
  expect(await json(empty)).toEqual({ draft: null });
  const saved = await owner.request(path, {
    method: "PUT",
    body: { revision: 0, schema: definition.schema, layout: definition.layout },
  });
  expect(saved.status).toBe(200);
  const payload = await json<{
    draft: { revision: number; schema: unknown; layout: unknown; updatedAt: string };
    warnings: string[];
  }>(saved);
  expect(payload.draft.revision).toBe(1);
  expect(payload.draft.schema).toEqual(definition.schema);
  expect(payload.draft.layout).toEqual(definition.layout);
  expect(Number.isNaN(Date.parse(payload.draft.updatedAt))).toBe(false);
  const loaded = await owner.request(path);
  expect(await json(loaded)).toEqual({ draft: payload.draft });
  const published = await json<{ version: number; definition: unknown }>(
    await owner.request(`/api/forms/${formId}`),
  );
  expect(published.version).toBe(1);
  expect(published.definition).toMatchObject(definition);
});

const save = (client: TestClient, revision: number, overrides: Record<string, unknown> = {}) =>
  client.request(`/api/forms/${formId}/draft`, {
    method: "PUT",
    body: { schema: definition.schema, layout: definition.layout, revision, ...overrides },
  });
const load = async (client = owner) =>
  json<{
    draft: {
      id: string;
      accountId: string;
      authorMembershipId: string;
      revision: number;
      schema: unknown;
      layout: unknown;
    };
  }>(await client.request(`/api/forms/${formId}/draft`));

it("이전 revision과 중복 최초 저장을409로 거부하고 최신 내용을 유지한다", async () => {
  expect((await save(owner, 0)).status).toBe(200);
  const changed = { fields: [{ type: "text", key: "subject", label: "수정" }] };
  expect((await save(owner, 1, { schema: changed })).status).toBe(200);
  for (const revision of [0, 1, 999]) {
    const response = await save(owner, revision);
    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({
      code: "revision_conflict",
      title: expect.stringContaining("다시 불러와"),
    });
  }
  expect((await load()).draft).toMatchObject({ revision: 2, schema: changed });
});

it("동시 최초 저장과 동시 갱신에서 각각 하나만 성공한다", async () => {
  for (const revision of [0, 1]) {
    const responses = await Promise.all(Array.from({ length: 12 }, () => save(owner, revision)));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(11);
    expect((await load()).draft.revision).toBe(revision + 1);
  }
});

it("같은 양식의 작성자별 초안은 독립적이며 작성자 위조 입력은 반영하지 않는다", async () => {
  await save(owner, 0);
  expect(await json(await admin.request(`/api/forms/${formId}/draft`))).toEqual({ draft: null });
  const first = (await load()).draft;
  expect(
    (
      await save(admin, 0, {
        authorMembershipId: first.authorMembershipId,
        accountId: first.accountId,
      })
    ).status,
  ).toBe(200);
  const second = (await load(admin)).draft;
  expect(second.authorMembershipId).not.toBe(first.authorMembershipId);
  expect(second.id).not.toBe(first.id);
  expect((await save(admin, 1)).status).toBe(200);
  expect((await load()).draft.revision).toBe(1);
});

it("미인증은401, 일반 구성원·범위 밖 관리자는403, 타 회사 양식은404다", async () => {
  expect((await getTestApp().request(`/api/forms/${formId}/draft`)).status).toBe(401);
  for (const client of [member, bizadmin]) {
    expect((await client.request(`/api/forms/${formId}/draft`)).status).toBe(403);
    expect((await save(client, 0)).status).toBe(403);
  }
  expect((await other.request(`/api/forms/${formId}/draft`)).status).toBe(404);
  expect((await save(other, 0)).status).toBe(404);
});

it("해당 사업자 양식 관리자는 자기 범위의 초안을 저장·조회할 수 있다", async () => {
  const [account] = await authDb.db
    .select()
    .from(schema.account)
    .where(eq(schema.account.slug, "fourm-test"));
  const businesses = await withTenant(appDb.db, account?.id ?? "", (tx) =>
    tx.select().from(schema.business),
  );
  const business = businesses.find((row) => row.code === "FM");
  expect(business).toBeDefined();
  const created = await owner.request("/api/forms", {
    method: "POST",
    body: {
      code: `scoped-${Date.now()}`,
      name: "사업자 초안",
      scope: { businessIds: [business?.id] },
      version: definition,
    },
  });
  expect(created.status).toBe(201);
  formId = (await json<{ formId: string }>(created)).formId;
  expect((await save(bizadmin, 0)).status).toBe(200);
  expect((await load(bizadmin)).draft.revision).toBe(1);
  expect(await json(await owner.request(`/api/forms/${formId}/draft`))).toEqual({ draft: null });
});

it("성공한 자동 저장만 감사에 남기며 필드 내용은 기록하지 않는다", async () => {
  await save(owner, 0);
  await save(owner, 1);
  expect((await save(owner, 1)).status).toBe(409);
  const draft = (await load()).draft;
  const logs = await withTenant(appDb.db, draft.accountId, (tx) =>
    tx
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.targetId, formId), eq(schema.auditLog.action, "form.save_draft")),
      ),
  );
  expect(logs).toHaveLength(2);
  expect(logs.every((row) => row.diff === null)).toBe(true);
  expect(JSON.stringify(logs)).not.toContain('"fields"');
});

it("명시적으로 저장할 때만 새 공개 버전이 생성되고 초안은 자동 공개되지 않는다", async () => {
  const changed = { fields: [{ type: "text", key: "subject", label: "초안 수정" }] };
  await save(owner, 0, { schema: changed });
  await save(owner, 1, { schema: changed });
  const detail = () =>
    owner.request(`/api/forms/${formId}`).then(json<{ version: number; definition: unknown }>);
  expect((await detail()).version).toBe(1);
  const response = await owner.request(`/api/forms/${formId}/versions`, {
    method: "POST",
    body: { version: { ...definition, schema: changed } },
  });
  expect(response.status).toBe(201);
  expect(await json(response)).toMatchObject({ version: 2 });
  expect(await detail()).toMatchObject({ version: 2, definition: { schema: changed } });
  expect((await load()).draft.revision).toBe(2);
});

it.each([-1, 0.5, 2_147_483_647, "0", null])("잘못된 revision %s은400이다", async (revision) => {
  expect((await save(owner, 0, { revision })).status).toBe(400);
});

it.each([
  { blocks: [] },
  { blocks: [{ kind: "field", key: "missing" }] },
  {
    blocks: [
      { kind: "field", key: "subject" },
      { kind: "field", key: "subject" },
    ],
  },
  { orientation: "invalid" },
  {
    blocks: [
      { kind: "heading", level: 1, text: "<script>" },
      { kind: "field", key: "subject" },
    ],
  },
])("초안·버전·가져오기 모두 잘못된 배치 %j를 거부한다", async (layout) => {
  const responses = [
    await save(owner, 0, { layout }),
    await owner.request(`/api/forms/${formId}/versions`, {
      method: "POST",
      body: { version: { ...definition, layout } },
    }),
    await owner.request("/api/forms", {
      method: "POST",
      body: {
        code: `invalid-${Date.now()}`,
        name: "잘못된 배치",
        version: { ...definition, layout },
      },
    }),
    await owner.request("/api/forms/import", {
      method: "POST",
      body: {
        data: {
          format: "fmerp-form/1",
          code: `import-${Date.now()}`,
          name: "잘못된 가져오기",
          category: "일반",
          version: { ...definition, layout },
        },
      },
    }),
  ];
  for (const response of responses) {
    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ code: "form_invalid" });
  }
  expect(await json(await owner.request(`/api/forms/${formId}/draft`))).toEqual({ draft: null });
});

it("잘못된 필드 정의는 저장하지 않고 기존 평면 배치는 허용한다", async () => {
  expect(
    (
      await save(owner, 0, {
        schema: { fields: [{ type: "text", key: "bad key", label: "잘못된 키" }] },
      })
    ).status,
  ).toBe(400);
  expect((await save(owner, 0, { layout: {} })).status).toBe(200);
  expect((await load()).draft.layout).toEqual({});
});

it("좁은 열 경고는 응답에 제공하되 저장을 막지 않는다", async () => {
  const fields = {
    fields: [
      {
        type: "table",
        key: "items",
        label: "항목",
        columns: [{ key: "name", label: "이름", type: "text" }],
      },
    ],
  };
  const response = await save(owner, 0, {
    schema: fields,
    layout: {
      orientation: "portrait",
      blocks: [{ kind: "columns", cols: [[{ kind: "field", key: "items" }], [], [], []] }],
    },
  });
  expect(response.status).toBe(200);
  expect((await json<{ warnings: string[] }>(response)).warnings).toHaveLength(1);
});

async function pgError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ cause: { code } });
}

it("실제 앱 DB 역할에서 RLS 조회·쓰기 격리와 복합 FK·유일성·revision 제약이 동작한다", async () => {
  await save(owner, 0);
  const draft = (await load()).draft;
  const [account] = await authDb.db
    .select()
    .from(schema.account)
    .where(eq(schema.account.slug, "other-company"));
  expect(account).toBeDefined();
  const otherId = account?.id ?? "";
  const [otherMember] = await authDb.db
    .select()
    .from(schema.membership)
    .where(eq(schema.membership.accountId, otherId));
  expect(otherMember).toBeDefined();
  const values = {
    accountId: draft.accountId,
    formId,
    authorMembershipId: draft.authorMembershipId,
    schema: definition.schema,
    layout: definition.layout,
  };
  const select = (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) =>
    tx.select().from(schema.formDraft).where(eq(schema.formDraft.id, draft.id));
  expect(
    await appDb.db.select().from(schema.formDraft).where(eq(schema.formDraft.id, draft.id)),
  ).toEqual([]);
  expect(await withTenant(appDb.db, otherId, select)).toEqual([]);
  expect(
    await withTenant(appDb.db, otherId, (tx) =>
      tx
        .update(schema.formDraft)
        .set({ revision: 10 })
        .where(eq(schema.formDraft.id, draft.id))
        .returning(),
    ),
  ).toEqual([]);
  expect(
    await withTenant(appDb.db, otherId, (tx) =>
      tx.delete(schema.formDraft).where(eq(schema.formDraft.id, draft.id)).returning(),
    ),
  ).toEqual([]);
  await pgError(
    withTenant(appDb.db, otherId, (tx) => tx.insert(schema.formDraft).values(values)),
    "42501",
  );
  await pgError(
    withTenant(appDb.db, draft.accountId, (tx) =>
      tx
        .update(schema.formDraft)
        .set({ accountId: otherId })
        .where(eq(schema.formDraft.id, draft.id)),
    ),
    "42501",
  );
  await pgError(
    withTenant(appDb.db, draft.accountId, (tx) => tx.insert(schema.formDraft).values(values)),
    "23505",
  );
  await pgError(
    withTenant(appDb.db, draft.accountId, (tx) =>
      tx.insert(schema.formDraft).values({ ...values, authorMembershipId: otherMember?.id ?? "" }),
    ),
    "23503",
  );
  await pgError(
    withTenant(appDb.db, otherId, (tx) =>
      tx
        .insert(schema.formDraft)
        .values({ ...values, accountId: otherId, authorMembershipId: otherMember?.id ?? "" }),
    ),
    "23503",
  );
  await pgError(
    withTenant(appDb.db, draft.accountId, (tx) =>
      tx.update(schema.formDraft).set({ revision: 0 }).where(eq(schema.formDraft.id, draft.id)),
    ),
    "23514",
  );
  await pgError(authDb.db.select().from(schema.formDraft), "42501");
  const rows = await withTenant(appDb.db, draft.accountId, (tx) =>
    tx
      .select()
      .from(schema.formDraft)
      .where(
        and(
          eq(schema.formDraft.formId, formId),
          eq(schema.formDraft.authorMembershipId, draft.authorMembershipId),
        ),
      ),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.revision).toBe(1);
});
